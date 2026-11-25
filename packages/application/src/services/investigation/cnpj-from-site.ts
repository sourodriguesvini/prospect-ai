import { COMPANY_CNPJ_KEY } from '@prospector/contracts';
import { loadInForce, type Run, type StepImpl } from './run';

/**
 * CNPJ publicado no site (KI-152, item 5): depois de ler as páginas, procura o CNPJ da empresa no
 * texto e, se só um bater com o nome na Receita, grava o CNPJ e os fatos do registro (porte,
 * atividade, situação, cidade) antes das análises e da qualificação. Sem isso, empresa vinda da
 * Descoberta fica sempre com "Pouco dado" na adequação ao ICP. Falha aqui nunca derruba a etapa:
 * o que não deu certo vai para o log e a investigação segue como antes.
 */
export async function linkCnpjFromSite(run: Run): Promise<boolean> {
  const link = run.deps.cnpjFromSite;
  if (!link || run.company.cnpj || run.pages.length === 0) return false;
  if (run.inForce.has(COMPANY_CNPJ_KEY)) return false;
  try {
    const result = await link(
      run.ctx,
      run.company.id,
      run.pages.map((page) => ({
        url: page.url,
        title: page.title,
        text: page.text,
        fetchedAt: page.fetchedAt,
        noArchive: page.noArchive,
      })),
    );
    if (result.status !== 'linked') {
      run.deps.log(`[investigação] CNPJ do site não vinculado: ${result.reason}`);
      return false;
    }
    // As etapas seguintes leem do ledger e da empresa: os fatos da Receita entram nelas.
    await loadInForce(run);
    const company = await run.deps.companies.get(run.company.id);
    if (company) run.company = company;
    run.produced.facts.push(...result.claimIds);
    return true;
  } catch (error) {
    run.signal.throwIfAborted();
    run.deps.log(
      `[investigação] CNPJ do site não vinculado: ${error instanceof Error ? error.name : 'erro'}`,
    );
    return false;
  }
}

/** A etapa `pages` seguida da procura do CNPJ, com `cnpj: 1` na contagem quando vinculou. */
export function withCnpjFromSite(step: StepImpl): StepImpl {
  return async (run) => {
    const outcome = await step(run);
    if (outcome.state !== 'done') return outcome;
    const linked = await linkCnpjFromSite(run);
    return linked ? { ...outcome, counts: { ...outcome.counts, cnpj: 1 } } : outcome;
  };
}
