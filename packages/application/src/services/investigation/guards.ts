import type {
  BusinessAnalysisOutput,
  CompetitorTriageOutput,
  DiagnosisOutput,
  ExtractedItem,
  ModelInference,
  VisualAuditOutput,
} from '@prospector/contracts';
import {
  deniesOwnSite,
  excerpt,
  forbiddenAssertion,
  type ForbiddenCode,
  hiringMention,
  incompleteStatement,
  looksLikeInjection,
  numbersOutsideQuote,
  recordChange,
  recordDiscard,
  sharesSubject,
  softenIntensifiers,
  type VerificationLog,
  withoutInconsistencyClaims,
} from '@prospector/domain';
import type {
  BusinessAnalysisInput,
  CompetitorTriageInput,
  DiagnosisInput,
  VisualAnalysisInput,
} from '../../ports/investigation';

/**
 * Guardas do servidor sobre o que vai para a IA local e o que volta dela, antes de virar claim
 * (KI-131, KI-133, KI-152; revisão do avaliador-ia e revisão independente de 2026-11-25). São
 * funções puras: as etapas da investigação (`analyze.ts`, `collect.ts`) as aplicam e registram o
 * que fizeram, e o conjunto de avaliação da investigação mede a saída do modelo já com elas, como
 * o usuário a veria.
 *
 * Valem para todas as versões dos prompts. O resto das regras (trecho citado precisa estar na
 * página, referência precisa existir, inferência precisa de fato) continua nas etapas.
 */

export interface GuardContext {
  /** O site da empresa foi lido nesta investigação (dizer que falta site contradiz o dossiê). */
  siteRead: boolean;
  /**
   * Frases cadastradas (problemas, sinais de necessidade e desqualificadores das ofertas):
   * repeti-las não é afirmá-las.
   */
  registered?: readonly string[];
  /** Nota de "Consistência visual" da auditoria (1 a 5), quando houver. */
  consistencyScore?: number | null;
}

/**
 * O que as guardas fizeram, separado (regra 8 do CLAUDE.md): conclusões descartadas inteiras,
 * textos ajustados (intensificador tirado, frase cortada, frase de instrução tirada da entrada) e
 * itens acrescentados pelo servidor. Os motivos levam o trecho atingido.
 */
export interface GuardLog {
  discards: string[];
  altered: string[];
  added: string[];
}

export interface Guarded<T> extends GuardLog {
  value: T;
}

export function emptyGuardLog(): GuardLog {
  return { discards: [], altered: [], added: [] };
}

/** Passa o que as guardas fizeram para o registro de verificação, cada coisa no seu contador. */
export function recordGuardLog(verification: VerificationLog, log: GuardLog): void {
  for (const reason of log.discards) recordDiscard(verification, reason);
  for (const reason of log.altered) recordChange(verification, 'altered', reason);
  for (const reason of log.added) recordChange(verification, 'added', reason);
}

interface TextRules {
  /** Afirmação (frase interrompida derruba) ou apoio (raciocínio, ângulo, objeção: corta). */
  role: 'statement' | 'support';
  /** Aplica "falta de site" (não vale em texto sobre concorrente). */
  site?: boolean;
  /** Barra "marca inconsistente" quando a auditoria deu nota 3 ou mais. */
  consistency?: boolean;
  /** Confere frase interrompida (o motivo da triagem é cortado no teto e não confere). */
  complete?: boolean;
  /** Tira intensificador (não vale em rótulo de item: "pacientes críticos" é o ramo). */
  soften?: boolean;
  /** Observação que não some por causa do intensificador (o achado visual fica). */
  keepFinding?: boolean;
  /** Assuntos liberados neste texto (a objeção pode falar de orçamento da empresa). */
  allow?: readonly ForbiddenCode[];
}

/** O texto até a última frase completa ("É filial (K2) e segue a rede. A oferta resolve o"). */
function completePart(text: string): string | null {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  while (sentences.length > 0 && incompleteStatement(sentences[sentences.length - 1] ?? '')) {
    sentences.pop();
  }
  const kept = sentences.join(' ').trim();
  return kept && !incompleteStatement(kept) ? kept : null;
}

/**
 * Um texto escrito pela IA pelas regras do servidor. Devolve o texto (às vezes sem o intensificador,
 * sem a frase que contradiz a auditoria ou cortado na última frase completa) ou null quando ele não
 * pode virar claim.
 */
export function checkText(
  ctx: GuardContext,
  text: string | null | undefined,
  rules: TextRules,
  log: GuardLog,
): string | null {
  if (!text || !text.trim()) return null;
  let current = text;
  // Raciocínio também (KI-131): o teto do contrato termina em "…", que não conta como interrupção.
  if (rules.complete !== false && incompleteStatement(current)) {
    const kept = rules.role === 'support' ? completePart(current) : null;
    if (!kept) {
      log.discards.push(`Conclusão descartada: frase interrompida pelo modelo (${excerpt(text)}).`);
      return null;
    }
    log.altered.push(
      `Texto cortado na última frase completa (${excerpt(current.trim().slice(kept.length), 60)}).`,
    );
    current = kept;
  }
  const hit = forbiddenAssertion(current, { allow: rules.allow ?? [] });
  if (hit) {
    log.discards.push(`Conclusão descartada: ${hit.reason} (${excerpt(current, 50)}).`);
    return null;
  }
  if (
    rules.site !== false &&
    ctx.siteRead &&
    deniesOwnSite(current, { registered: ctx.registered })
  ) {
    log.discards.push(
      `Conclusão descartada: dizia que falta site, mas o site foi lido (${excerpt(current, 60)}).`,
    );
    return null;
  }
  if (rules.consistency && (ctx.consistencyScore ?? 0) >= 3) {
    const kept = withoutInconsistencyClaims(current, { registered: ctx.registered });
    if (!kept) {
      log.discards.push(
        `Conclusão descartada: marca inconsistente contra a nota da auditoria (${excerpt(current, 60)}).`,
      );
      return null;
    }
    if (kept !== current) {
      log.altered.push(
        `Frase cortada: marca inconsistente contra a nota da auditoria (${excerpt(current, 60)}).`,
      );
      current = kept;
    }
  }
  if (rules.soften === false) return current;
  const softened = softenIntensifiers(current);
  if (softened === current) return current;
  if (softened) {
    log.altered.push(`Intensificador sem base tirado (${excerpt(current, 80)}).`);
    return softened;
  }
  if (rules.keepFinding) return current;
  log.discards.push(`Conclusão descartada: juízo de gravidade sem base (${excerpt(current, 70)}).`);
  return null;
}

function guardInference(
  ctx: GuardContext,
  inference: ModelInference | null,
  log: GuardLog,
  consistency = false,
): ModelInference | null {
  if (!inference) return null;
  const statement = checkText(ctx, inference.statement, { role: 'statement', consistency }, log);
  if (!statement) return null;
  const reasoning = checkText(ctx, inference.reasoning, { role: 'support' }, log);
  if (!reasoning) return null;
  return { ...inference, statement, reasoning };
}

/**
 * Tira do conteúdo externo as frases (ou linhas) que falam com a IA. Só a frase sai: o resto da
 * página, do resultado de pesquisa ou do item do dossiê continua.
 */
function withoutInjection(text: string, log: GuardLog, where: string): string {
  return text
    .split(/(?<=[\n.!?])/)
    .filter((line) => {
      if (!looksLikeInjection(line)) return true;
      log.altered.push(
        `Frase que parecia instrução para a IA tirada ${where} (${excerpt(line, 60)}).`,
      );
      return false;
    })
    .join('')
    .trim();
}

// -----------------------------------------------------------------------------
// Negócio
// -----------------------------------------------------------------------------

export function guardBusinessInput(input: BusinessAnalysisInput): Guarded<BusinessAnalysisInput> {
  const log = emptyGuardLog();
  const pages = input.pages.map((page) => ({
    ...page,
    text: withoutInjection(page.text, log, 'da página lida'),
  }));
  return { value: { ...input, pages }, ...log };
}

const HIRING_LABEL = /\b(vagas?|contrat\w*|seletiv\w*|curr[íi]cul\w*|emprego)\b/i;
/** Teto de sinais do contrato da análise do site. */
const MAX_SIGNALS = 3;

/**
 * Saída da análise do site: rótulos com número que não está no trecho saem ("20 anos" com
 * "desde 1998"), textos passam pelas regras (rótulo sem tirar intensificador: é o ramo), e o
 * anúncio de vagas entra como sinal quando o modelo deixa passar e ainda cabe (o trecho é literal
 * da página; não desloca sinal do modelo).
 */
export function guardBusinessOutput(
  input: BusinessAnalysisInput,
  output: BusinessAnalysisOutput,
  ctx: GuardContext,
): Guarded<BusinessAnalysisOutput> {
  const log = emptyGuardLog();
  const item = (entry: ExtractedItem): ExtractedItem | null => {
    const label = checkText(ctx, entry.label, { role: 'statement', soften: false }, log);
    if (!label) return null;
    if (numbersOutsideQuote(label, entry.quote).length > 0) {
      log.discards.push(
        `Item descartado: número no rótulo que não está no trecho citado (${excerpt(label, 60)}).`,
      );
      return null;
    }
    return { ...entry, label };
  };
  const list = (entries: readonly ExtractedItem[]) =>
    entries.map(item).filter((entry): entry is ExtractedItem => entry !== null);

  const signals = list(output.signals);
  if (
    signals.length < MAX_SIGNALS &&
    !signals.some((signal) => HIRING_LABEL.test(`${signal.label} ${signal.quote}`))
  ) {
    for (const page of input.pages) {
      const quote = hiringMention(page.text);
      if (!quote) continue;
      signals.push({ label: 'Vagas abertas', page: page.ref, quote });
      log.added.push(`Sinal de vagas abertas lido no texto do site (${excerpt(quote, 80)}).`);
      break;
    }
  }
  return {
    value: {
      ...output,
      offerings: list(output.offerings),
      audiences: list(output.audiences),
      differentiators: list(output.differentiators),
      regions: list(output.regions),
      signals,
      segment: output.segment ? item(output.segment) : output.segment,
      valueProposition: guardInference(ctx, output.valueProposition, log),
      toneOfVoice: guardInference(ctx, output.toneOfVoice, log),
      businessModel: guardInference(ctx, output.businessModel, log),
    },
    ...log,
  };
}

// -----------------------------------------------------------------------------
// Auditoria visual
// -----------------------------------------------------------------------------

export function guardVisualInput(input: VisualAnalysisInput): Guarded<VisualAnalysisInput> {
  const log = emptyGuardLog();
  const context = input.context.flatMap((line) => {
    const text = withoutInjection(line.text, log, 'do contexto da auditoria');
    return text ? [{ ...line, text }] : [];
  });
  return { value: { ...input, context }, ...log };
}

/** A observação é o achado: intensificador sem oração à parte não derruba o critério. */
export function guardVisualOutput(
  output: VisualAuditOutput,
  ctx: GuardContext,
): Guarded<VisualAuditOutput> {
  const log = emptyGuardLog();
  const criteria = output.criteria.flatMap((finding) => {
    const observation = checkText(
      ctx,
      finding.observation,
      { role: 'statement', keepFinding: true },
      log,
    );
    return observation ? [{ ...finding, observation }] : [];
  });
  return {
    value: { criteria, positioning: guardInference(ctx, output.positioning, log) },
    ...log,
  };
}

// -----------------------------------------------------------------------------
// Triagem de concorrentes
// -----------------------------------------------------------------------------

/** Só a frase que fala com a IA sai do título e do trecho; o candidato continua na triagem. */
export function guardTriageInput(input: CompetitorTriageInput): Guarded<CompetitorTriageInput> {
  const log = emptyGuardLog();
  const candidates = input.candidates.map((candidate) => {
    const title = withoutInjection(candidate.title, log, 'do resultado de pesquisa');
    const snippet = withoutInjection(candidate.snippet, log, 'do resultado de pesquisa');
    return { ...candidate, title: title || candidate.domain, snippet };
  });
  return { value: { ...input, candidates }, ...log };
}

/** O motivo fala do concorrente: "sem site próprio" ali não contradiz o dossiê da empresa. */
export function guardTriageOutput(
  output: CompetitorTriageOutput,
  ctx: GuardContext,
): Guarded<CompetitorTriageOutput> {
  const log = emptyGuardLog();
  const candidates = output.candidates.flatMap((candidate) => {
    const reason = checkText(
      ctx,
      candidate.reason,
      { role: 'support', site: false, complete: false },
      log,
    );
    return reason ? [{ ...candidate, reason }] : [];
  });
  return { value: { candidates }, ...log };
}

// -----------------------------------------------------------------------------
// Diagnóstico
// -----------------------------------------------------------------------------

export function guardDiagnosisInput(input: DiagnosisInput): Guarded<DiagnosisInput> {
  const log = emptyGuardLog();
  const facts = input.facts.flatMap((fact) => {
    const text = withoutInjection(fact.text, log, 'do dossiê');
    return text ? [{ ...fact, text }] : [];
  });
  return { value: { ...input, facts }, ...log };
}

/** Nota de "Consistência visual" numa linha do dossiê ("… (nota 4 de 5, …)"). */
export function consistencyScoreFromFacts(facts: DiagnosisInput['facts']): number | null {
  for (const fact of facts) {
    const match = /^Consist[êe]ncia visual:.*\(nota (\d) de 5/i.exec(fact.text);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Saída do diagnóstico: textos pelas regras, relevância forte sem fato vira moderada, e
 * desqualificador só conta com fato do mesmo assunto, nas duas versões (na v1, entre os fatos da
 * leitura; na v2, o fato citado). "Marca inconsistente" contra a nota da auditoria só é barrada no
 * resumo e na afirmação da oferta, fora as frases cadastradas das ofertas; hipótese, raciocínio e
 * "a verificar" podem levantar a dúvida (Instagram, fachada, dado divergente).
 */
export function guardDiagnosisOutput(
  input: DiagnosisInput,
  output: DiagnosisOutput,
  ctx: GuardContext,
): Guarded<DiagnosisOutput> {
  const log = emptyGuardLog();
  const context: GuardContext = {
    ...ctx,
    registered: [
      ...(ctx.registered ?? []),
      ...input.offers.flatMap((offer) => [
        ...offer.problems,
        ...offer.needSignals,
        ...offer.disqualifiers,
      ]),
    ],
  };
  const factText = new Map(
    input.facts
      .filter((fact) => fact.type === 'fact')
      .map((fact) => [fact.ref.toUpperCase(), fact.text]),
  );
  const factsOf = (refs: readonly string[]) =>
    refs
      .map((ref) => factText.get(ref.trim().toUpperCase()))
      .filter((text): text is string => text !== undefined);
  const support = (text: string | null, allow: readonly ForbiddenCode[] = []) =>
    checkText(context, text, { role: 'support', allow }, log);

  const summary = guardInference(context, output.summary, log, true);
  const hypotheses = output.hypotheses.flatMap((hypothesis) => {
    const statement = checkText(context, hypothesis.statement, { role: 'statement' }, log);
    const reasoning = statement ? support(hypothesis.reasoning) : null;
    return statement && reasoning ? [{ ...hypothesis, statement, reasoning }] : [];
  });

  const offers = output.offers.flatMap((entry) => {
    const offer = input.offers.find(
      (candidate) => candidate.ref.toUpperCase() === entry.offer.trim().toUpperCase(),
    );
    const statement = checkText(
      context,
      entry.statement,
      { role: 'statement', consistency: true },
      log,
    );
    const reasoning = statement ? support(entry.reasoning) : null;
    if (!statement || !reasoning) {
      log.discards.push(`Leitura de oferta sem justificativa aceita: não conta (${entry.offer}).`);
      return [];
    }
    const cited = factsOf(entry.basedOn);
    let relevance = entry.relevance;
    if (relevance === 'strong' && cited.length === 0) {
      relevance = 'moderate';
      log.altered.push(
        `Relevância forte sem fato por trás rebaixada para moderada (${entry.offer}).`,
      );
    }
    const texts = offer?.disqualifiers ?? [];
    const named = (position: number) => excerpt(texts[position - 1] ?? `#${position}`, 60);
    const sameSubject = (position: number, facts: readonly string[]) => {
      const text = texts[position - 1];
      return text !== undefined && facts.some((fact) => sharesSubject(text, fact));
    };
    const disqualifiersHit = [...new Set(entry.disqualifiersHit)].filter((position) => {
      if (sameSubject(position, cited)) return true;
      log.discards.push(
        `Desqualificador sem fato do mesmo assunto: não conta (${named(position)}).`,
      );
      return false;
    });
    const disqualifiers = entry.disqualifiers?.filter((item) => {
      if (sameSubject(item.position, factsOf(item.basedOn))) return true;
      log.discards.push(
        `Desqualificador sem fato do mesmo assunto: não conta (${named(item.position)}).`,
      );
      return false;
    });
    const strings = (list: readonly string[], allow: readonly ForbiddenCode[] = []) =>
      list.map((text) => support(text, allow)).filter((text): text is string => Boolean(text));
    return [
      {
        ...entry,
        relevance,
        statement,
        reasoning,
        openingAngle: support(entry.openingAngle),
        // A objeção é o que a empresa pode dizer ("Não temos orçamento agora"), não afirmação.
        objections: strings(entry.objections, ['budget']),
        toVerify: strings(entry.toVerify),
        disqualifiersHit,
        ...(disqualifiers ? { disqualifiers } : {}),
      },
    ];
  });
  return { value: { summary, hypotheses, offers }, ...log };
}
