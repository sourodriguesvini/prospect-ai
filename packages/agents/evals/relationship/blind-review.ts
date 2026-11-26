/**
 * Leitura humana às cegas (proposta de 26/11, Frente 2 — EXPERIMENTAL, não usado pelo app). Junta
 * pares de mensagens do mesmo caso, geradas por duas versões (de prompt ou de modelo), numa página
 * HTML local, sem dizer qual é qual. Quem lê escolhe a que enviaria e marca o que vê em cada uma;
 * a página baixa as respostas em JSON e `tallyBlindReview` cruza com a chave, guardada à parte.
 *
 * A página não carrega nada de fora (sem script, fonte ou imagem externa) e só mostra textos de
 * casos SINTÉTICOS das avaliações.
 */

export interface BlindText {
  /** Quem gerou (ex.: "v3 · qwen3.5:4b"); nunca aparece na página. */
  label: string;
  subject: string | null;
  body: string;
}

export interface BlindPair {
  caseId: string;
  a: BlindText;
  b: BlindText;
}

export interface BlindKeyEntry {
  item: number;
  caseId: string;
  /** Rótulo do texto mostrado como "Mensagem 1" e como "Mensagem 2". */
  first: string;
  second: string;
}

export type BlindChoice = '1' | '2' | 'nenhuma' | 'tanto-faz';

export interface BlindAnswer {
  item: number;
  choice: BlindChoice | null;
  /** Marcas por mensagem ("1" e "2"). */
  marks: Record<'1' | '2', { human: boolean; concrete: boolean; wrong: boolean }>;
  note: string;
}

/** Gerador pseudoaleatório com semente (mulberry32): a mesma semente, a mesma ordem. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textBlock(position: '1' | '2', text: BlindText, item: number): string {
  const subject = text.subject ? `<p class="subject">Assunto: ${escapeHtml(text.subject)}</p>` : '';
  const mark = (name: string, label: string) =>
    `<label><input type="checkbox" name="i${item}-${position}-${name}"> ${label}</label>`;
  return `<section class="text"><h3>Mensagem ${position}</h3>${subject}<pre>${escapeHtml(text.body)}</pre>
<fieldset><legend>Nesta mensagem</legend>${mark('human', 'Parece escrita por uma pessoa')}${mark('concrete', 'Diz algo concreto da empresa')}${mark('wrong', 'Tem algo errado, inventado ou que eu não diria')}</fieldset></section>`;
}

/**
 * Monta a página e a chave. A ordem dos itens e qual texto fica como "Mensagem 1" dependem da
 * semente; a chave (quem gerou cada texto) fica fora da página.
 */
export function buildBlindReview(
  pairs: readonly BlindPair[],
  options: { seed: number; title: string },
): { html: string; key: BlindKeyEntry[] } {
  const next = random(options.seed);
  const order = pairs.map((pair) => ({ pair, sort: next() })).sort((a, b) => a.sort - b.sort);
  // Posição equilibrada: metade dos itens mostra cada versão como "Mensagem 1" (quem lê tende a
  // preferir a primeira); com número ímpar, o item que sobra é sorteado.
  const half = Math.floor(order.length / 2);
  const swaps = order.map((_, index) =>
    index < half ? true : index === half && order.length % 2 === 1 ? next() < 0.5 : false,
  );
  for (let index = swaps.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [swaps[index], swaps[other]] = [swaps[other] ?? false, swaps[index] ?? false];
  }
  const key: BlindKeyEntry[] = [];
  const items = order.map(({ pair }, index) => {
    const item = index + 1;
    const swap = swaps[index] ?? false;
    const first = swap ? pair.b : pair.a;
    const second = swap ? pair.a : pair.b;
    key.push({ item, caseId: pair.caseId, first: first.label, second: second.label });
    const choice = (value: BlindChoice, label: string) =>
      `<label><input type="radio" name="i${item}-choice" value="${value}"> ${label}</label>`;
    return `<article data-item="${item}"><h2>Item ${item}</h2><div class="pair">${textBlock('1', first, item)}${textBlock('2', second, item)}</div>
<fieldset><legend>Qual você enviaria?</legend>${choice('1', 'Mensagem 1')}${choice('2', 'Mensagem 2')}${choice('nenhuma', 'Nenhuma')}${choice('tanto-faz', 'Tanto faz')}</fieldset>
<label class="note">Observação (opcional)<textarea name="i${item}-note" rows="2"></textarea></label></article>`;
  });
  const script = `const total=${order.length};
document.getElementById('baixar').addEventListener('click',()=>{const answers=[];
for(let item=1;item<=total;item++){const pick=document.querySelector('input[name="i'+item+'-choice"]:checked');
const marks={};for(const p of ['1','2']){marks[p]={};for(const m of ['human','concrete','wrong']){marks[p][m]=document.querySelector('input[name="i'+item+'-'+p+'-'+m+'"]').checked;}}
answers.push({item,choice:pick?pick.value:null,marks,note:document.querySelector('textarea[name="i'+item+'-note"]').value});}
const blob=new Blob([JSON.stringify({answers},null,2)],{type:'application/json'});const link=document.createElement('a');
link.href=URL.createObjectURL(blob);link.download='respostas-leitura-as-cegas.json';link.click();});`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:1rem;color:#1d1d1b;background:#faf9f6}
article{border-top:1px solid #ddd;padding:1rem 0}.pair{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}
.text{background:#fff;border:1px solid #e3e1db;border-radius:.75rem;padding:1rem}pre{white-space:pre-wrap;font:inherit;margin:.5rem 0}
.subject{color:#555;margin:0}fieldset{border:0;padding:0;margin:.5rem 0;display:flex;flex-wrap:wrap;gap:.25rem 1rem}
legend{font-weight:600;margin-bottom:.25rem}.note{display:block}.note textarea{display:block;width:100%;margin-top:.25rem}
button{font:inherit;padding:.6rem 1.2rem;border-radius:999px;border:0;background:#1d1d1b;color:#fff;cursor:pointer}
</style></head><body><h1>${escapeHtml(options.title)}</h1>
<p>Textos de casos SINTÉTICOS das avaliações. Cada item mostra duas versões da mesma mensagem, em ordem sorteada; a página não diz qual versão gerou cada uma. Leia, marque e, no fim, baixe as respostas.</p>
${items.join('\n')}
<p><button type="button" id="baixar">Baixar respostas</button></p>
<script>${script}</script></body></html>`;
  return { html, key };
}

export interface BlindTally {
  items: number;
  answered: number;
  /** Por rótulo: quantas vezes foi a escolhida e quantas marcas recebeu. */
  byLabel: Record<string, { chosen: number; human: number; concrete: number; wrong: number }>;
  neither: number;
  tie: number;
}

/** Cruza as respostas baixadas da página com a chave. */
export function tallyBlindReview(
  answers: readonly BlindAnswer[],
  key: readonly BlindKeyEntry[],
): BlindTally {
  const byItem = new Map(key.map((entry) => [entry.item, entry]));
  const byLabel: BlindTally['byLabel'] = {};
  const slot = (label: string) =>
    (byLabel[label] ??= { chosen: 0, human: 0, concrete: 0, wrong: 0 });
  let answered = 0;
  let neither = 0;
  let tie = 0;
  for (const answer of answers) {
    const entry = byItem.get(answer.item);
    if (!entry) continue;
    const labels = { '1': entry.first, '2': entry.second } as const;
    for (const position of ['1', '2'] as const) {
      const target = slot(labels[position]);
      const marks = answer.marks[position];
      if (marks.human) target.human += 1;
      if (marks.concrete) target.concrete += 1;
      if (marks.wrong) target.wrong += 1;
    }
    if (answer.choice === null) continue;
    answered += 1;
    if (answer.choice === 'nenhuma') neither += 1;
    else if (answer.choice === 'tanto-faz') tie += 1;
    else slot(labels[answer.choice]).chosen += 1;
  }
  return { items: key.length, answered, byLabel, neither, tie };
}
