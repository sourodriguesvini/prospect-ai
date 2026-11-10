import {
  COMPANY_LIFECYCLE_LABELS,
  CONFIDENCE_BAND_LABELS,
  CompanyLifecycle,
  formatCnpj,
  type Company,
  type EntityRef,
} from '@prospector/contracts';
import { z } from 'zod';
import type { RequestContext } from '../context';
import { AppError } from '../errors';
import type { CompanyService } from '../services/company-service';
import { defineTool, type ToolDefinition } from './registry';

/**
 * Ferramentas de leitura de empresas e dossiês (M2) para o Copiloto. Só leitura: nenhuma consulta
 * externa (o CNPJ é consultado pela tela, não pelo modelo). Cada fato vai com o tipo (fato,
 * inferência, hipótese), a confiança e a fonte, para o modelo não apresentar hipótese como fato.
 * Dado de demonstração vai marcado `demo: true` (mesmo nome das ferramentas de estratégia).
 * A telemetria (`tool_calls`, só inclusão) não guarda nome de empresa: no MEI é o nome da pessoa.
 */

const EPISTEMIC_LABEL = { fact: 'fato', inference: 'inferência', hypothesis: 'hipótese' } as const;
const STATUS_LABEL: Record<string, string> = {
  active: 'em vigor',
  stale: 'vencido (precisa de nova coleta)',
  disputed: 'contestado',
  rejected: 'rejeitado',
  superseded: 'substituído',
};

const MAX_COMPANIES = 20;
const MAX_CLAIMS = 25;

function companyView(company: Company) {
  return {
    id: company.id,
    nome: company.displayName,
    cnpj: company.cnpj ? formatCnpj(company.cnpj) : null,
    cidade: company.city && company.uf ? `${company.city}/${company.uf}` : (company.uf ?? null),
    situacao: COMPANY_LIFECYCLE_LABELS[company.lifecycle],
    ...(company.isDemo ? { demo: true } : {}),
  };
}

/** Tipo da referência informada, para a telemetria (sem o texto, que pode ser nome de pessoa). */
function referenceKind(reference: string): string {
  const wanted = reference.trim();
  if (z.uuid().safeParse(wanted).success) return '[id]';
  if (/^[0-9A-Za-z./-]{14,18}$/.test(wanted) && /\d{2}/.test(wanted)) return '[cnpj]';
  return '[nome]';
}

const companyRef = (company: Company): EntityRef => ({
  kind: 'company',
  id: company.id,
  label: company.displayName.slice(0, 120),
});

/** Aceita o id, o CNPJ ou o nome (sem diferenciar maiúsculas) e devolve o id da empresa. */
async function resolveCompany(
  companies: CompanyService,
  ctx: RequestContext,
  reference: string,
): Promise<string> {
  const wanted = reference.trim();
  if (z.uuid().safeParse(wanted).success) return wanted;
  const found = await companies.list(ctx, { search: wanted, includeArchived: true, limit: 5 });
  const lower = wanted.toLowerCase();
  const match =
    found.find((company) => company.displayName.toLowerCase() === lower) ??
    (found.length === 1 ? found[0] : undefined);
  if (!match) throw new AppError('not_found', 'not_found');
  return match.id;
}

export function companyTools(deps: { companies: CompanyService }): ToolDefinition[] {
  const { companies } = deps;
  return [
    defineTool({
      name: 'list_companies',
      title: 'Consultando empresas',
      description:
        'Lista as empresas cadastradas no Prospector (nome, CNPJ, cidade, situação no funil). ' +
        'Use para "quantas empresas eu tenho", "quais empresas de Curitiba" ou para achar uma ' +
        'empresa pelo nome antes de abrir o dossiê. Não pesquisa empresas novas na internet.',
      input: z.object({
        busca: z
          .string()
          .trim()
          .max(120)
          .optional()
          .describe('Parte do nome, da razão social, do domínio ou do CNPJ.'),
        situacao: CompanyLifecycle.optional().describe('Filtra pela situação no funil.'),
      }),
      kind: 'read',
      telemetryInput: (input) => ({
        busca: input.busca ? '[texto]' : null,
        situacao: input.situacao ?? null,
      }),
      async run(ctx, input) {
        const list = await companies.list(ctx, {
          search: input.busca ?? '',
          lifecycle: input.situacao ?? null,
          limit: MAX_COMPANIES + 1,
        });
        const shown = list.slice(0, MAX_COMPANIES);
        const more = list.length > MAX_COMPANIES;
        const count = `${more ? `Mais de ${MAX_COMPANIES}` : list.length} empresa${list.length === 1 ? '' : 's'}`;
        const summary =
          list.length === 0
            ? input.busca || input.situacao
              ? 'Nenhuma empresa encontrada com esse filtro.'
              : 'Nenhuma empresa cadastrada ainda.'
            : `${count}${input.busca ? ` para "${input.busca}"` : ''}.`;
        return {
          summary,
          telemetrySummary: list.length === 0 ? summary : `${count}.`,
          data: {
            empresas: shown.map(companyView),
            ...(more ? { observacao: 'Lista cortada: peça um filtro.' } : {}),
          },
          refs: [
            { kind: 'company', id: null, label: 'Empresas' },
            ...shown.slice(0, 10).map(companyRef),
          ],
        };
      },
    }),
    defineTool({
      name: 'get_company_dossier',
      title: 'Abrindo o dossiê da empresa',
      description:
        'Mostra o dossiê de uma empresa cadastrada: dados do cadastro e os fatos, inferências e ' +
        'hipóteses registrados, cada um com confiança, fonte e data. Informe o nome, o CNPJ ou o ' +
        'id. Não busca nada novo: só o que já foi registrado.',
      input: z.object({
        empresa: z.string().trim().min(2).max(160).describe('Nome, CNPJ ou id da empresa.'),
      }),
      kind: 'read',
      telemetryInput: (input) => ({ empresa: referenceKind(input.empresa) }),
      async run(ctx, input) {
        const id = await resolveCompany(companies, ctx, input.empresa);
        const dossier = await companies.dossier(ctx, id);
        const { company, summary } = dossier;
        const claims = dossier.claims.slice(0, MAX_CLAIMS).map((view) => {
          const source = view.evidence[0]?.source ?? null;
          return {
            afirmacao: view.claim.statement,
            tipo: EPISTEMIC_LABEL[view.claim.epistemicType],
            confianca: CONFIDENCE_BAND_LABELS[view.band],
            estado: STATUS_LABEL[view.status] ?? view.status,
            fonte: source ? (source.title ?? source.provider ?? source.kind) : null,
            coletado_em: source ? source.capturedAt.slice(0, 10) : null,
            ...(view.claim.isDemo ? { demo: true } : {}),
          };
        });
        const counts =
          summary.total === 0
            ? 'nenhum fato registrado ainda.'
            : `${summary.facts} fato(s), ${summary.inferences} inferência(s), ${summary.hypotheses} hipótese(s)${summary.stale ? `, ${summary.stale} vencido(s)` : ''}.`;
        return {
          summary: `${company.displayName}: ${counts}`,
          telemetrySummary: `Dossiê: ${counts}`,
          data: {
            empresa: {
              ...companyView(company),
              razao_social: company.legalName,
              dominio: company.primaryDomain,
              ultima_investigacao: company.lastInvestigatedAt?.slice(0, 10) ?? null,
            },
            registros: claims,
            ...(dossier.claims.length > MAX_CLAIMS
              ? { observacao: `Mostrando ${MAX_CLAIMS} de ${dossier.claims.length}.` }
              : {}),
          },
          refs: [companyRef(company)],
        };
      },
    }),
  ];
}
