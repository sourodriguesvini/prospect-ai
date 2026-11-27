/**
 * Revisão humana da qualidade das análises (diretriz 2026-11-26, Parte 8: "inclua revisão humana
 * dos resultados; não utilize apenas o próprio modelo para julgar a qualidade do próprio trabalho").
 *
 * Monta uma página HTML local com cada análise (resumo executivo, tese, fontes e, quando houver, a
 * mensagem) e um formulário de 1 a 5 por métrica. Quem lê é a pessoa da agência; a página baixa as
 * respostas em JSON e `tallyQualityReview` apura médias, concordância da recomendação, taxa de
 * falsos positivos e tempo de resposta. Nenhum modelo dá nota aqui.
 *
 * A página não carrega nada de fora (sem script, fonte ou imagem externa).
 */

export type QualityMetricKey =
  | 'factual_precision'
  | 'freshness'
  | 'source_quality'
  | 'analysis_depth'
  | 'strategic_relevance'
  | 'commercial_fit'
  | 'decision_makers'
  | 'message_naturalness'
  | 'personalization'
  | 'context_fit';

export interface QualityMetric {
  readonly key: QualityMetricKey;
  readonly label: string;
  /** A pergunta que a pessoa responde de 1 (não) a 5 (sim, sem ressalva). */
  readonly question: string;
  /** Só vale quando a análise traz mensagem. */
  readonly needsMessage: boolean;
}

/**
 * As dez métricas lidas por uma pessoa. As outras duas da Parte 8 são medidas: tempo de resposta
 * (o tempo gravado de cada análise) e taxa de falsos positivos (recomendação de abordar que a
 * pessoa diz estar errada).
 */
export const QUALITY_METRICS: readonly QualityMetric[] = [
  {
    key: 'factual_precision',
    label: 'Precisão factual',
    question: 'O que está escrito confere com as fontes citadas, sem nada inventado?',
    needsMessage: false,
  },
  {
    key: 'freshness',
    label: 'Atualidade das informações',
    question: 'As informações são recentes o bastante para decidir agora?',
    needsMessage: false,
  },
  {
    key: 'source_quality',
    label: 'Qualidade das fontes',
    question: 'As fontes são confiáveis e próprias para o que sustentam?',
    needsMessage: false,
  },
  {
    key: 'analysis_depth',
    label: 'Profundidade da análise',
    question: 'A análise vai além do óbvio e explica o porquê?',
    needsMessage: false,
  },
  {
    key: 'strategic_relevance',
    label: 'Relevância estratégica',
    question: 'O que a análise destaca importa para o negócio da empresa?',
    needsMessage: false,
  },
  {
    key: 'commercial_fit',
    label: 'Compatibilidade comercial',
    question: 'O que a análise sugere oferecer é algo que a agência entrega e que cabe ao caso?',
    needsMessage: false,
  },
  {
    key: 'decision_makers',
    label: 'Qualidade dos decisores',
    question: 'O papel indicado para a conversa é quem de fato decide ou influencia?',
    needsMessage: false,
  },
  {
    key: 'message_naturalness',
    label: 'Naturalidade da mensagem',
    question: 'A mensagem parece escrita por uma pessoa?',
    needsMessage: true,
  },
  {
    key: 'personalization',
    label: 'Personalização',
    question: 'A mensagem só faria sentido para esta empresa?',
    needsMessage: true,
  },
  {
    key: 'context_fit',
    label: 'Adequação ao contexto',
    question: 'O tom, o momento e o canal combinam com a situação da empresa?',
    needsMessage: false,
  },
];

export type ReviewRecommendation = 'approach' | 'deepen_research' | 'deprioritize';

export interface QualityReviewItem {
  /** Identificador estável do item (ex.: "caso-1-flash"). */
  readonly id: string;
  readonly title: string;
  /** true = caso SINTÉTICO das avaliações; a página diz isso no item. */
  readonly synthetic: boolean;
  /** Como a análise foi feita (ex.: "regra compatibility/v1, sem modelo"). */
  readonly producedBy: string;
  readonly recommendation: {
    readonly key: ReviewRecommendation;
    readonly label: string;
    readonly reason: string;
  };
  readonly summary: ReadonlyArray<{ readonly question: string; readonly text: string }>;
  readonly principal: {
    readonly title: string;
    readonly problem: string;
    readonly whyNow: string;
    readonly offer: readonly string[];
    readonly approachRole: string;
    readonly openingTopic: string;
  } | null;
  readonly doNotOffer: readonly string[];
  readonly toConfirm: readonly string[];
  readonly sources: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  readonly message: { readonly subject: string | null; readonly body: string } | null;
  /** Tempo medido para produzir a análise, em milissegundos (null = não medido). */
  readonly durationMs: number | null;
  /** O que o tempo mede (ex.: "só a regra, sem busca na internet"). */
  readonly durationNote: string | null;
}

export type QualityScore = 1 | 2 | 3 | 4 | 5;

export interface QualityAnswer {
  readonly item: string;
  /** null = não se aplica (ou não respondido). */
  readonly scores: Partial<Record<QualityMetricKey, QualityScore | null>>;
  /** A recomendação do sistema está certa? */
  readonly recommendationRight: boolean | null;
  readonly note: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Só endereços http(s) viram link; o resto aparece como texto. */
function safeLink(label: string, url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `<a href="${escapeHtml(parsed.href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a> <span class="host">(${escapeHtml(parsed.host)})</span>`;
    }
  } catch {
    // endereço inválido: cai no texto abaixo
  }
  return `${escapeHtml(label)} <span class="host">(${escapeHtml(url)})</span>`;
}

function list(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`;
}

function metricsFor(item: QualityReviewItem): QualityMetric[] {
  return QUALITY_METRICS.filter((metric) => !metric.needsMessage || item.message !== null);
}

function itemBlock(item: QualityReviewItem, index: number): string {
  const n = index + 1;
  const summary = item.summary
    .map((row) => `<dt>${escapeHtml(row.question)}</dt><dd>${escapeHtml(row.text)}</dd>`)
    .join('');
  const principal = item.principal
    ? `<section><h3>Tese principal: ${escapeHtml(item.principal.title)}</h3><dl>
<dt>Problema potencial</dt><dd>${escapeHtml(item.principal.problem)}</dd>
<dt>Por que agora</dt><dd>${escapeHtml(item.principal.whyNow)}</dd>
<dt>O que oferecer</dt><dd>${escapeHtml(item.principal.offer.join(', '))}</dd>
<dt>Com quem falar</dt><dd>${escapeHtml(item.principal.approachRole)}</dd>
<dt>Para abrir</dt><dd>${escapeHtml(item.principal.openingTopic)}</dd></dl></section>`
    : '<p class="muted">Sem tese principal.</p>';
  const doNot = item.doNotOffer.length
    ? `<section><h3>Não oferecer</h3>${list(item.doNotOffer)}</section>`
    : '';
  const toConfirm = item.toConfirm.length
    ? `<section><h3>A confirmar</h3>${list(item.toConfirm)}</section>`
    : '';
  const sources = item.sources.length
    ? `<section><h3>Fontes</h3><ul>${item.sources.map((source) => `<li>${safeLink(source.label, source.url)}</li>`).join('')}</ul></section>`
    : '<p class="muted">Sem fontes citadas.</p>';
  const message = item.message
    ? `<section class="message"><h3>Mensagem</h3>${item.message.subject ? `<p class="muted">Assunto: ${escapeHtml(item.message.subject)}</p>` : ''}<pre>${escapeHtml(item.message.body)}</pre></section>`
    : '<p class="muted">Sem mensagem nesta análise: naturalidade e personalização ficam fora deste item.</p>';
  const time =
    item.durationMs === null
      ? '<p class="muted">Tempo de resposta: não medido.</p>'
      : `<p class="muted">Tempo de resposta medido: ${seconds(item.durationMs)}${item.durationNote ? ` (${escapeHtml(item.durationNote)})` : ''}.</p>`;
  const scale = (metric: QualityMetric) => {
    const name = `i${n}-${metric.key}`;
    const options = [1, 2, 3, 4, 5]
      .map(
        (score) => `<label><input type="radio" name="${name}" value="${score}"> ${score}</label>`,
      )
      .join('');
    return `<fieldset><legend>${escapeHtml(metric.label)}: ${escapeHtml(metric.question)}</legend>${options}<label><input type="radio" name="${name}" value="na"> Não se aplica</label></fieldset>`;
  };
  return `<article data-item="${escapeHtml(item.id)}" data-index="${n}">
<h2>${n}. ${escapeHtml(item.title)}${item.synthetic ? ' <span class="tag">SINTÉTICO</span>' : ''}</h2>
<p class="muted">Feito por: ${escapeHtml(item.producedBy)}</p>
<p class="rec"><strong>Recomendação do sistema:</strong> ${escapeHtml(item.recommendation.label)}. ${escapeHtml(item.recommendation.reason)}</p>
<section><h3>Resumo executivo</h3><dl>${summary}</dl></section>
${principal}${doNot}${toConfirm}${sources}${message}${time}
<div class="form"><h3>Sua avaliação (1 = não, 5 = sim, sem ressalva)</h3>
${metricsFor(item).map(scale).join('\n')}
<fieldset><legend>A recomendação do sistema está certa?</legend><label><input type="radio" name="i${n}-rec" value="sim"> Sim</label><label><input type="radio" name="i${n}-rec" value="nao"> Não</label></fieldset>
<label class="note">Por quê? O que está errado ou faltando? (opcional)<textarea name="i${n}-note" rows="2"></textarea></label></div>
</article>`;
}

/** Monta a página de revisão. Os itens aparecem na ordem dada. */
export function buildQualityReview(
  items: readonly QualityReviewItem[],
  options: { title: string },
): string {
  const ids = JSON.stringify(items.map((item) => item.id)).replaceAll('<', '\\u003c');
  const metrics = JSON.stringify(QUALITY_METRICS.map((metric) => metric.key));
  const script = `const ids=${ids};const metrics=${metrics};
document.getElementById('baixar').addEventListener('click',()=>{const answers=ids.map((id,index)=>{const n=index+1;const scores={};
for(const key of metrics){const pick=document.querySelector('input[name="i'+n+'-'+key+'"]:checked');if(!pick)continue;scores[key]=pick.value==='na'?null:Number(pick.value);}
const rec=document.querySelector('input[name="i'+n+'-rec"]:checked');
return {item:id,scores,recommendationRight:rec?rec.value==='sim':null,note:document.querySelector('textarea[name="i'+n+'-note"]').value};});
const blob=new Blob([JSON.stringify({answers},null,2)],{type:'application/json'});const link=document.createElement('a');
link.href=URL.createObjectURL(blob);link.download='respostas-revisao-de-qualidade.json';link.click();});`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;color:#1d1d1b;background:#faf9f6}
article{border-top:1px solid #ddd;padding:1rem 0}h2{font-size:1.3rem}h3{font-size:1rem;margin:1rem 0 .25rem}
dl{display:grid;grid-template-columns:minmax(10rem,14rem) 1fr;gap:.25rem 1rem;margin:0}dt{font-weight:600}dd{margin:0}
@media (max-width:40rem){dl{grid-template-columns:1fr}}
.muted,.host{color:#555}.tag{font-size:.75rem;border:1px solid #999;border-radius:999px;padding:0 .5rem;vertical-align:middle}
.message pre{white-space:pre-wrap;font:inherit;background:#fff;border:1px solid #e3e1db;border-radius:.75rem;padding:1rem}
.form{background:#fff;border:1px solid #e3e1db;border-radius:.75rem;padding:1rem;margin-top:1rem}
fieldset{border:0;padding:0;margin:.5rem 0;display:flex;flex-wrap:wrap;gap:.25rem 1rem}legend{font-weight:600;margin-bottom:.25rem}
.note{display:block}.note textarea{display:block;width:100%;margin-top:.25rem}
button{font:inherit;padding:.6rem 1.2rem;border-radius:999px;border:0;background:#1d1d1b;color:#fff;cursor:pointer}
</style></head><body><h1>${escapeHtml(options.title)}</h1>
<p>Cada item mostra uma análise do Prospector como ela aparece para quem decide. Confira as fontes, dê de 1 a 5 em cada métrica (ou "não se aplica") e diga se a recomendação está certa. No fim, baixe as respostas. A nota é sua: nenhum modelo avalia aqui.</p>
${items.map(itemBlock).join('\n')}
<p><button type="button" id="baixar">Baixar respostas</button></p>
<script>${script}</script></body></html>`;
}

export interface MetricTally {
  readonly key: QualityMetricKey;
  readonly label: string;
  /** Notas dadas (sem "não se aplica"). */
  readonly n: number;
  readonly mean: number | null;
  /** Parcela de notas 1 ou 2. */
  readonly lowShare: number | null;
}

export interface QualityTally {
  readonly items: number;
  /** Itens com ao menos uma resposta. */
  readonly answered: number;
  readonly syntheticOnly: boolean;
  readonly metrics: readonly MetricTally[];
  /** Concordância da pessoa com a recomendação do sistema (doc 11 §4.3: ≥ 80%). */
  readonly recommendation: {
    readonly answered: number;
    readonly agreed: number;
    readonly agreement: number | null;
  };
  /** Recomendações de abordar que a pessoa disse estarem erradas. */
  readonly falsePositives: {
    readonly approachAnswered: number;
    readonly wrong: number;
    readonly rate: number | null;
  };
  readonly responseTime: {
    readonly n: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
  };
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Apura as respostas baixadas da página contra os itens revisados. */
export function tallyQualityReview(
  items: readonly QualityReviewItem[],
  answers: readonly QualityAnswer[],
): QualityTally {
  const byId = new Map(items.map((item) => [item.id, item]));
  const valid = answers.filter((answer) => byId.has(answer.item));
  const metrics = QUALITY_METRICS.map((metric): MetricTally => {
    const scores = valid.flatMap((answer) => {
      const score = answer.scores[metric.key];
      return typeof score === 'number' && score >= 1 && score <= 5 ? [score] : [];
    });
    const n = scores.length;
    return {
      key: metric.key,
      label: metric.label,
      n,
      mean: n ? round(scores.reduce((sum, score) => sum + score, 0) / n) : null,
      lowShare: n ? round(scores.filter((score) => score <= 2).length / n) : null,
    };
  });
  const judged = valid.filter((answer) => answer.recommendationRight !== null);
  const agreed = judged.filter((answer) => answer.recommendationRight === true).length;
  const approach = judged.filter(
    (answer) => byId.get(answer.item)?.recommendation.key === 'approach',
  );
  const wrong = approach.filter((answer) => answer.recommendationRight === false).length;
  const times = items
    .flatMap((item) => (item.durationMs === null ? [] : [item.durationMs]))
    .sort((a, b) => a - b);
  const answered = valid.filter(
    (answer) =>
      answer.recommendationRight !== null ||
      answer.note.trim() !== '' ||
      Object.values(answer.scores).some((score) => score !== undefined),
  ).length;
  return {
    items: items.length,
    answered,
    syntheticOnly: items.length > 0 && items.every((item) => item.synthetic),
    metrics,
    recommendation: {
      answered: judged.length,
      agreed,
      agreement: judged.length ? round(agreed / judged.length) : null,
    },
    falsePositives: {
      approachAnswered: approach.length,
      wrong,
      rate: approach.length ? round(wrong / approach.length) : null,
    },
    responseTime: {
      n: times.length,
      p50Ms: percentile(times, 50),
      p95Ms: percentile(times, 95),
    },
  };
}

/** Relatório em Markdown da apuração (pt-BR), para anexar à avaliação. */
export function qualityTallyMarkdown(tally: QualityTally): string {
  const pct = (value: number | null) =>
    value === null ? 'sem resposta' : `${Math.round(value * 100)}%`;
  const rows = tally.metrics
    .map(
      (metric) =>
        `| ${metric.label} | ${metric.n} | ${metric.mean === null ? 'sem nota' : metric.mean.toLocaleString('pt-BR')} | ${pct(metric.lowShare)} |`,
    )
    .join('\n');
  const time =
    tally.responseTime.n === 0
      ? 'não medido'
      : `p50 ${seconds(tally.responseTime.p50Ms ?? 0)}, p95 ${seconds(tally.responseTime.p95Ms ?? 0)} (${tally.responseTime.n} análises)`;
  return `# Revisão humana da qualidade

${tally.syntheticOnly ? '**Só casos SINTÉTICOS.** ' : ''}${tally.answered} de ${tally.items} itens com resposta.

| Métrica | Notas | Média (1 a 5) | Notas 1 ou 2 |
|---|---|---|---|
${rows}

- **Recomendação certa (concordância):** ${pct(tally.recommendation.agreement)} (${tally.recommendation.agreed} de ${tally.recommendation.answered}); limiar do doc 11 §4.3: 80%.
- **Taxa de falsos positivos:** ${pct(tally.falsePositives.rate)} (${tally.falsePositives.wrong} de ${tally.falsePositives.approachAnswered} recomendações de abordar).
- **Tempo de resposta:** ${time}.
`;
}
