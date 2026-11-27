import type {
  AiClaim,
  AiContext,
  ApproachAiRequest,
  MessageAiRequest,
} from '@prospector/application';
import {
  EMPTY_APPROACH_INSIGHTS,
  type ApproachAiOutput,
  type MessageDraftText,
  type SelectedThesis,
  type ThesisAngle,
} from '@prospector/contracts';

/**
 * Casos SINTÉTICOS da avaliação do Relacionamento (`synthetic: true`), inspirados nos erros do
 * teste real de 2026-11-24 (KI-150): fonte trocada ("o site destaca a loja nova" quando veio do
 * Instagram ou só do pedido), histórico inventado ("o contato pelo LinkedIn não foi possível"),
 * exagero ("inconsistências visuais graves" a partir de 6 de 41 amostras) e reescrita que traz de
 * volta o que o usuário tirou; e os do KI-124 (base limitada, agência sem nome, empresa
 * individual, follow-up, rodapé). Empresas, domínios e bairros inventados (`.test`).
 *
 * Fora da amostra (`holdout: true`): outra empresa, outros números e a forma real com que um
 * achado da pesquisa chega do ledger. Só rodam com EVAL_HOLDOUT=1, na rodada final, com texto,
 * código e corretores congelados.
 *
 * Os corretores não usam as listas do código da conferência (`reviewDraft`): proporção pela conta
 * da evidência, intensificador com lista própria e paráfrases da loja que o usuário tirou.
 */

export interface Check<T> {
  name: string;
  /** Corretor de tolerância zero: uma falha reprova a versão, qualquer que seja a média. */
  zeroTolerance?: boolean;
  /** Só informa (fica de fora da taxa): mostra, por exemplo, se o texto citou a loja. */
  informative?: boolean;
  pass(output: T): boolean;
}

export interface ApproachCase {
  id: string;
  synthetic: true;
  holdout?: true;
  input: ApproachAiRequest;
  checks: Check<ApproachAiOutput>[];
}

export interface MessageCase {
  id: string;
  synthetic: true;
  holdout?: true;
  input: MessageAiRequest;
  checks: Check<MessageDraftText>[];
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENCY = 'Estúdio Faro';
const SITE = 'petvila.test';

// --- Texto ------------------------------------------------------------------------------------

/** Minúsculas, sem acentos e com espaços simples: os corretores comparam por aqui. */
export const plain = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Frases do texto (por pontuação final ou quebra de linha). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Frases que falam do termo. */
export const sentencesAbout = (text: string, term: string) =>
  sentences(text).filter((sentence) => plain(sentence).includes(plain(term)));

/**
 * Trechos (orações ligadas por "mas", "porém", ponto e vírgula ou um verbo de outra fonte, como
 * "e soube") que falam de algum dos termos. Vírgula antes de "e" não separa: em "o site lista as
 * lojas do Centro, do Água Verde, e a nova", a loja nova continua atribuída ao site.
 */
export const clausesAbout = (text: string, terms: string | readonly string[]) => {
  const list = (typeof terms === 'string' ? [terms] : terms).map(plain);
  return sentences(text)
    .flatMap((sentence) =>
      sentence.split(
        /;|,\s*(?:mas|porém|além disso)\s|\s(?:mas|porém|enquanto|e soube|e também soube|e fiquei sabendo|e ouvi falar)\s/i,
      ),
    )
    .filter((clause) => list.some((term) => plain(clause).includes(term)));
};

/** "Uma notícia", "pela notícia": a notícia como fonte ("tenho notícia de" não é fonte). */
const NEWS = String.raw`\b(n[ao]|numa|pela|segundo a|em uma|de uma|uma) (noticia|reportagem)\b|\breportagem\b|\bjornal\b`;
/**
 * Oração que diz DE ONDE veio uma informação: "no site", "pelo Instagram", "o site da X destaca",
 * notícia. A lista de canais ("lojas, site e redes sociais falem igual") não é fonte.
 */
const sourcePattern = (words: string) =>
  new RegExp(
    String.raw`\b(?:no|na|nos|nas|pelo|pela|pelos|pelas|segundo o|segundo a|conforme o|conforme a|via|vi|vimos|olhei|visitei|acessei|consultei)\s+(?:(?:o|a|os|as|seu|sua|seus|suas)\s+)?${words}\b|\b${words}(?:\s+(?:da|do|de)\s+\S+)?\s+(?:mostr|list|traz|trouxe|destac|anunci|diz|diss|inform|apresent|exib|revel|apont|indic|cit|mencion|divulg|fala)\w*|${NEWS}`,
  );
const ANY_SOURCE = sourcePattern(
  String.raw`(?:site|pagina|instagram|perfil|posts?|publicac(?:ao|oes)|redes? sociais|rede social|facebook|linkedin)`,
);
/** Fontes que não são o Instagram (o achado do caso veio dele). */
const NOT_INSTAGRAM = sourcePattern(String.raw`(?:site|pagina|facebook|linkedin)`);

/** A loja nova da PetVila e as paráfrases dela ("a loja que vocês vão abrir"). */
const NEW_STORE_TERMS = [
  'vila aurora',
  'loja nova',
  'nova loja',
  'nova unidade',
  'unidade nova',
  'abertura',
  'vao abrir',
  'vai abrir',
  'inaugur',
  'quarta loja',
];
/** O contraste medido (6 de 41): o usuário tirou da versão revisada. */
const CONTRAST_TERMS = ['contraste', 'amostra', '6 de 41', '41 amostras', 'wcag', 'legibilidade'];

/**
 * Intensificadores (lista própria, maior que a do código), conferidos com acento: "séria" não é
 * "seria". Fora: "levar a sério", "uma crítica", "um crítico", "no total".
 */
const INTENSIFIER =
  /(?<![\p{L}])(gravíssim\p{L}*|graves?|séri[oa]s?|crític[oa]s?|sever[oa]s?|alarmantes?|péssim\p{L}*|preocupantes?|gritantes?|enormes?|completamente|totalmente|extremamente|urgentes?|desastros\p{L}*|terríve(?:l|is))(?![\p{L}])/giu;
function intensifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(INTENSIFIER)) {
    const word = match[0].toLowerCase();
    const before = text.slice(Math.max(0, match.index - 14), match.index).toLowerCase();
    if (/^séri/.test(word) && /\ba\s+$/.test(before)) continue;
    if (/^crític/.test(word) && /\b(uma|um|a|o|as|os|sem|com|de)\s+$/.test(before)) continue;
    found.push(word);
  }
  return found;
}

/** Tentativa ou falha de contato que nenhum dado mostra (primeiro contato). */
const CONTACT_WORDS = /\b(contato|contatos|linkedin|e-?mail|telefone|whatsapp|ligacao|canal)\b/;
const NO_PREVIOUS =
  /\b(sem|ausencia de|nenhum|nenhuma|nao ha|nao houve|falta de)\s+(\S+\s+){0,3}anteriore?s?\b|\bnao (foi|foram|houve|teve|tivemos)\s+(\S+\s+){0,2}anteriormente\b/g;
const INVENTED_HISTORY =
  /(nao foi possivel|nao conseguimos|nao consegui|tentamos|tentei|tentou|tentativa anterior|nao respondeu|nao responderam|nao retornou|nao retornaram|anterior|ja (fizemos|tivemos|houve|foi feito|foi feita))/;

/** Experiência, especialidade ou clientes da agência (os DADOS dos casos não trazem nenhum). */
const AGENCY_EXPERIENCE =
  /\b((temos|tenho|nossa|com|ampla|vasta|muita|longa|anos de) (\S+ )?(experiencia|especialidade|trajetoria|mercado)|especialistas|especializad[oa]s?|ja (ajudamos|atendemos|trabalhamos|fizemos)|nossos clientes|clientes como|portfolio de clientes|outros clientes|marcas que atendemos)\b/;

/** Linha de lista (hífen, asterisco, marcador ou número). */
const LIST_LINE = /^\s*(?:[-–—•*]|\d{1,2}[.)])\s+\S/;
const GREETING =
  /^(ola|oi|prezad[oa]s?|car[oa]s?|bom dia|boa tarde|boa noite|ilustr\w*|senhor\w*|equipe)\b/;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const draftText = (draft: MessageDraftText) => `${draft.subject ?? ''}\n${draft.body}`;
const strategyText = (output: ApproachAiOutput) => {
  const { strategy } = output;
  return [
    strategy.opportunity,
    strategy.channelReason,
    strategy.argument,
    strategy.nextStep,
    ...strategy.evidence.map((point) => point.statement),
    ...strategy.gaps,
    ...strategy.risks,
  ].join('\n');
};

// --- Corretores reutilizáveis -------------------------------------------------------------------

/** Nenhuma oração que fala dos termos cita uma fonte que não é a dela (sem exceção por citar a certa junto). */
function noSourceFor(
  terms: string | readonly string[],
  pattern: RegExp,
  what: string,
): Check<MessageDraftText> {
  const label = typeof terms === 'string' ? terms : terms[0]!;
  return {
    name: `não atribui "${label}" a ${what}`,
    zeroTolerance: true,
    pass: (draft) =>
      clausesAbout(draftText(draft), terms).every((clause) => !pattern.test(plain(clause))),
  };
}

const mentions = (terms: readonly string[], name: string, informative = false) => ({
  name,
  informative,
  pass: (draft: MessageDraftText) => terms.some((term) => plain(draft.body).includes(plain(term))),
});

const noIntensifiers: Check<MessageDraftText> = {
  name: 'mensagem sem intensificador (grave, sério, crítico, enorme...)',
  pass: (draft) => intensifiers(draftText(draft)).length === 0,
};

/**
 * Proporção pela conta da evidência (`part` de `total`): percentual só perto do real, "X de Y" só
 * o da evidência, nada de maioria ou metade quando a parte é menor que a metade, e frase sobre o
 * assunto com marca de parte ("alguns", "parte", a contagem) ou em forma de pergunta.
 */
const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function proportionOk(
  text: string,
  part: number,
  total: number,
  topic: ((sentence: string) => boolean) | null,
  body: string = text,
): boolean {
  const value = plain(text);
  const real = (100 * part) / total;
  for (const match of value.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|por cento)/g)) {
    if (Math.abs(Number(match[1]!.replace(',', '.')) - real) > 2) return false;
  }
  for (const match of value.matchAll(/\b(\d+) (?:de|em|das|dos) (?:cada )?(\d+)\b/g)) {
    if (Number(match[1]) !== part || Number(match[2]) !== total) return false;
  }
  // Por extenso ("seis das quarenta e uma"): a parte tem de ser a da evidência.
  for (const match of value.matchAll(
    /\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez) (?:de|em|das|dos) (?:cada )?(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta)\b/g,
  )) {
    if (NUMBER_WORDS[match[1]!] !== part) return false;
  }
  // Contagem solta ("6 amostras") só com o número da evidência.
  for (const match of value.matchAll(/\b(\d+) (?:amostras|paginas)\b/g)) {
    if (Number(match[1]) !== part && Number(match[1]) !== total) return false;
  }
  if (
    part / total < 0.5 &&
    /\b(maioria|maior parte|mais da metade|metade|grande parte|boa parte|quase tod[oa]s?|praticamente tod[oa]s?|tod[oa]s? as? (paginas|amostras|textos)|todo o site|site inteiro|site todo|em todo)\b/.test(
      value,
    )
  ) {
    return false;
  }
  const PART =
    /\b(alguns|algumas|algum|alguma|parte|partes|trechos?|pontos?|certos|certas|poucos|poucas|\d+ d[eao]s? \d+|(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez) (?:de|das|dos) (?:cada )?(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta)|(?:\d+|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez) (?:amostras?|paginas?|textos?|trechos?)|uma parcela|em alguns|nem todos|nem todas)\b|\d+ ?%|\?/;
  if (!topic) return true;
  return sentences(body)
    .filter((sentence) => topic(plain(sentence)))
    .every((sentence) => PART.test(plain(sentence)));
}

const proportion = (
  part: number,
  total: number,
  topic: (sentence: string) => boolean,
  where: string,
): Check<MessageDraftText> => ({
  name: `proporção da evidência (${part} de ${total}, como parte) na ${where}`,
  pass: (draft) => proportionOk(draftText(draft), part, total, topic, draft.body),
});

const noInventedHistory = (text: (output: ApproachAiOutput) => string, where: string) => ({
  name: `sem tentativa ou contato anterior inventado (${where})`,
  zeroTolerance: true,
  pass: (output: ApproachAiOutput) =>
    sentences(text(output)).every((sentence) => {
      // "Sem contatos anteriores", "na ausência de contato anterior": é o certo, não história.
      const value = plain(sentence).replace(NO_PREVIOUS, ' ');
      return !(CONTACT_WORDS.test(value) && INVENTED_HISTORY.test(value));
    }),
});

const noAgencyExperience: Check<MessageDraftText> = {
  name: 'sem experiência, especialidade ou clientes inventados da agência',
  zeroTolerance: true,
  pass: (draft) => !AGENCY_EXPERIENCE.test(plain(draftText(draft))),
};

/** Lugar (nome depois de "no", "na", "bairro"...) que não está nos DADOS nem no PEDIDO. */
function invented(text: string, data: string): string[] {
  const known = plain(data);
  const found: string[] = [];
  for (const match of text.matchAll(
    /(?:^|[\s(])(?:no|na|nos|nas|em|do|da|dos|das|bairro|unidade|loja|filial)\s+((?:\p{Lu}[\p{L}\p{M}]*)(?:[ \t]+(?:de |do |da )?\p{Lu}[\p{L}\p{M}]*)*)/gu,
  )) {
    if (!known.includes(plain(match[1]!))) found.push(match[1]!);
  }
  return found;
}

/** Tudo o que os DADOS e o PEDIDO trazem (nomes de lugar valem se aparecem aqui). */
function dataText(input: AiContext & { instruction: string | null }): string {
  return [
    input.company.displayName,
    input.company.city ?? '',
    input.company.uf ?? '',
    input.agencyName ?? '',
    input.offer.name,
    input.offer.description ?? '',
    ...input.offer.problems,
    ...input.offer.needSignals,
    ...input.offer.deliverables,
    ...input.offer.valueProps,
    ...input.claims.map((item) => item.statement),
    input.instruction ?? '',
    'Instagram LinkedIn WhatsApp Facebook TikTok YouTube Google Brasil',
  ].join(' ');
}

const noInventedPlace = (data: string): Check<MessageDraftText> => ({
  name: 'mensagem sem lugar inventado',
  zeroTolerance: true,
  pass: (draft) => invented(draftText(draft), data).length === 0,
});

/** Inferência dita com cuidado: oração sobre ela com "talvez", "parece", pergunta ou a fonte. */
const HEDGE =
  /\b(talvez|parece|pelo que (vi|soube|entendi|percebi)|ao que (parece|tudo indica)|se nao me engano|se entendi|imagino|possivelmente|provavelmente|pode ser|estariam|estaria|soube|ouvi|vi que|instagram)\b|\?/;
const inferenceWithCare = (terms: readonly string[], what: string): Check<MessageDraftText> => ({
  name: `inferência (${what}) com cuidado, não como certeza`,
  pass: (draft) => clausesAbout(draft.body, terms).every((clause) => HEDGE.test(plain(clause))),
});

/** A primeira frase depois da saudação diz quem escreve; a despedida traz o nome da agência. */
const introducesAgency = (agency: string): Check<MessageDraftText> => ({
  name: 'nome da agência na primeira frase depois da saudação',
  pass: (draft) => {
    const first = sentences(draft.body).find(
      (sentence) => !(GREETING.test(plain(sentence)) && words(sentence) <= 8),
    );
    return Boolean(first && plain(first).includes(plain(agency)));
  },
});
const signsOff = (agency: string): Check<MessageDraftText> => ({
  name: 'termina com a despedida e o nome da agência',
  pass: (draft) => {
    const lines = draft.body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    // A última linha é a assinatura (curta, com o nome); a apresentação no meio não conta.
    const last = lines.at(-1) ?? '';
    return (
      lines.length >= 2 && plain(last).includes(plain(agency)) && words(last) <= words(agency) + 5
    );
  },
});
const noList: Check<MessageDraftText> = {
  name: 'em parágrafos, sem lista com hífen ou número',
  pass: (draft) => draft.body.split('\n').filter((line) => LIST_LINE.test(line)).length < 2,
};

const baseDraftChecks = (maxWords: number, marker = false): Check<MessageDraftText>[] => [
  marker
    ? {
        name: 'só o marcador do nome da agência entre colchetes',
        zeroTolerance: true,
        pass: (draft) =>
          [...draftText(draft).matchAll(/\[([^\]]*)\]/g)].every(
            (match) => plain(match[1]!) === 'nome da agencia',
          ),
      }
    : {
        name: 'sem marcador entre colchetes',
        zeroTolerance: true,
        pass: (draft) => !/\[[^\]]*\]/.test(draftText(draft)),
      },
  {
    name: 'sem anexo nem link',
    pass: (draft) => !/\b(anexo|anexado|em anexo|link)\b|https?:\/\//.test(plain(draftText(draft))),
  },
  { name: `até ${maxWords} palavras`, pass: (draft) => words(draft.body) <= maxWords },
  {
    name: 'assunto curto (até 60 caracteres) ou nulo',
    pass: (draft) => draft.subject === null || draft.subject.length <= 60,
  },
  noAgencyExperience,
  noIntensifiers,
  noList,
];

/** Primeiro contato: apresentação com o nome da agência e despedida com ele. */
const firstContactChecks = (agency: string) => [introducesAgency(agency), signsOff(agency)];

const approachDraft = (check: Check<MessageDraftText>): Check<ApproachAiOutput> => ({
  name: check.name,
  zeroTolerance: check.zeroTolerance,
  informative: check.informative,
  pass: (output) => check.pass(output.message),
});

/** Estratégia: lugar inventado, intensificador e proporção também nos campos da estratégia. */
const strategyChecks = (data: string, part: number, total: number): Check<ApproachAiOutput>[] => [
  {
    name: 'estratégia sem lugar inventado',
    zeroTolerance: true,
    pass: (output) => invented(strategyText(output), data).length === 0,
  },
  {
    name: 'estratégia sem intensificador',
    pass: (output) => intensifiers(strategyText(output)).length === 0,
  },
  {
    name: `estratégia com a proporção da evidência (${part} de ${total})`,
    // Na estratégia (leitura interna), só a conta: maioria, metade, percentual e "X de Y".
    pass: (output) => proportionOk(strategyText(output), part, total, null),
  },
];

// --- Dados da empresa ---------------------------------------------------------------------------

const SITE_SOURCE = { kind: 'web_page', tier: 'company_owned', host: SITE } as const;
const CAPTURE_SOURCE = { kind: 'screenshot', tier: 'company_owned', host: SITE } as const;
const INSTAGRAM_SOURCE = { kind: 'search_result', tier: 'unknown', host: 'instagram.com' } as const;
const REGISTRY_SOURCE = { kind: 'api_record', tier: 'official_registry', host: null } as const;

const claim = (
  n: number,
  statement: string,
  epistemicType: AiClaim['epistemicType'],
  sources: AiClaim['sources'],
  domain = 'digital_presence',
): AiClaim => ({
  id: ID(n),
  domain,
  statement,
  epistemicType,
  band: epistemicType === 'fact' ? 'high' : 'medium',
  sources,
});

const STORES = claim(
  1,
  'O site lista três lojas em Curitiba: Centro, Água Verde e Jardim Botânico.',
  'fact',
  [SITE_SOURCE],
  'firmographic',
);
const CONTRAST = claim(
  2,
  'Medição automática do contraste: 6 de 41 amostras de texto ficaram abaixo do mínimo recomendado (WCAG AA).',
  'fact',
  [CAPTURE_SOURCE],
  'brand',
);
/** Achado do Instagram que não diz a fonte na frase: só a `fonte` mostra de onde veio. */
const NEW_STORE = claim(
  3,
  'A empresa prepara a abertura de uma loja no bairro Vila Aurora.',
  'inference',
  [INSTAGRAM_SOURCE],
  'growth',
);
const COLORS = claim(
  4,
  'O laranja do logotipo no site é diferente do laranja usado nos posts recentes.',
  'inference',
  [SITE_SOURCE, INSTAGRAM_SOURCE],
  'brand',
);
const ACTIVE = claim(
  5,
  'Empresa ativa desde 2014, com sede em Curitiba (PR).',
  'fact',
  [REGISTRY_SOURCE],
  'firmographic',
);

const BASE: AiContext = {
  company: {
    displayName: 'PetVila Sintética',
    city: 'Curitiba',
    uf: 'PR',
    cnaeMain: '4789-0/04',
    sizeBand: 'EPP',
    primaryDomain: SITE,
    individual: false,
  },
  claims: [STORES, CONTRAST, COLORS, ACTIVE],
  insights: EMPTY_APPROACH_INSIGHTS,
  offer: {
    name: 'Sistema de identidade visual',
    description: 'Organização da marca e das peças para que lojas, site e redes falem igual.',
    problems: ['Marca aplicada de jeitos diferentes em cada canal.'],
    needSignals: ['Cores e logotipos diferentes entre site e redes sociais.'],
    deliverables: ['Manual de marca', 'Biblioteca de peças para redes sociais'],
    valueProps: ['A marca é reconhecida igual em todas as lojas e canais.'],
  },
  voice: null,
  agencyName: AGENCY,
  optOutText: null,
  cases: [],
};

/** Diagnóstico exagerado (leitura interna): a mensagem não pode repetir o "grave". */
const EXAGGERATED_DIAGNOSIS: AiContext['insights'] = {
  ...EMPTY_APPROACH_INSIGHTS,
  diagnosis: {
    id: ID(500),
    status: 'complete',
    summary:
      'Inconsistências visuais graves entre site e redes, com falhas críticas de contraste no site.',
    findings: [
      {
        statement: 'Inconsistência visual grave: cores da marca diferentes entre site e posts.',
        claimIds: [ID(4)],
      },
      { statement: 'Falhas críticas de contraste no site.', claimIds: [ID(2)] },
    ],
    producedAt: '2026-11-24T12:00:00Z',
    promptId: null,
  },
};

const approach = (overrides: Partial<ApproachAiRequest>): ApproachAiRequest => ({
  ...BASE,
  basis: 'sufficient',
  gaps: [],
  firstContact: true,
  kind: 'initial_email',
  tone: 'consultative',
  instruction: null,
  ...overrides,
});

/** Texto que o usuário corrigiu: tirou a loja nova (não confirmada) e suavizou o contraste. */
const EDITED_BODY = [
  'Olá, equipe da PetVila!',
  '',
  'Sou do Estúdio Faro, um estúdio de identidade visual. Vi no site de vocês as três lojas em Curitiba, no Centro, no Água Verde e no Jardim Botânico, e reparei que o laranja da marca aparece em tons diferentes entre o site e as redes.',
  '',
  'Quando a rede cresce, manter a marca igual em todas as lojas e canais ajuda o cliente a reconhecer vocês de longe. Podemos conversar 20 minutos sobre como organizar isso?',
  '',
  'Abraço,',
  'Estúdio Faro',
].join('\n');

const STRATEGY: MessageAiRequest['strategy'] = {
  opportunity: 'Rede de pet shops em expansão com a marca aplicada de jeitos diferentes.',
  objective: 'conversation',
  counterpartRole: 'Sócios ou marketing',
  channel: 'email',
  channelReason: 'O tipo pedido é um e-mail de apresentação.',
  argument: 'Com mais lojas, uma marca organizada evita que cada canal fale de um jeito.',
  evidence: [
    { statement: 'Loja nova prevista no bairro Vila Aurora.', claimIds: [ID(3)] },
    { statement: 'Laranja diferente entre site e posts.', claimIds: [ID(4)] },
  ],
  nextStep: 'Propor uma conversa de 20 minutos.',
  gaps: [],
  risks: [],
  caseIds: [],
};

const message = (overrides: Partial<MessageAiRequest>): MessageAiRequest => ({
  ...BASE,
  claims: [STORES, CONTRAST, NEW_STORE, COLORS, ACTIVE],
  kind: 'initial_email',
  tone: 'consultative',
  channel: 'email',
  firstContact: true,
  strategy: STRATEGY,
  previous: null,
  replyTo: null,
  instruction: null,
  ...overrides,
});

/** Frase que fala de um problema de contraste (não a que só cita o serviço). */
const CONTRAST_TOPIC = (sentence: string) =>
  /\bcontraste\b/.test(sentence) &&
  /\b(baix\w*|abaixo|frac\w*|insuficiente|problemas?|falhas?|ruim|dificult\w*|prejudic\w*|nao passa\w*|leitura|ler)\b/.test(
    sentence,
  );

// --- Casos da PetVila (KI-150) -------------------------------------------------------------------

const PEDIDO_SEM_FONTE = approach({
  instruction: 'Cite a loja nova da PetVila no bairro Vila Aurora.',
});
const CANAL_EMAIL = approach({ claims: [...BASE.claims, NEW_STORE], tone: 'direct' });
const PROPORCAO = approach({
  insights: EXAGGERATED_DIAGNOSIS,
  instruction: 'Fale do contraste e das cores da marca.',
});
const BASE_LIMITADA = approach({
  basis: 'limited',
  claims: [STORES, ACTIVE],
  gaps: ['Quem decide sobre a marca.', 'Se há equipe de marketing.'],
});

/** Corretores comuns da estratégia e da mensagem de uma abordagem de primeiro contato. */
const approachCommon = (input: ApproachAiRequest): Check<ApproachAiOutput>[] => [
  noInventedHistory(
    (output) => `${strategyText(output)}\n${draftText(output.message)}`,
    'estratégia e mensagem',
  ),
  ...strategyChecks(dataText(input), 6, 41),
  approachDraft(noInventedPlace(dataText(input))),
  approachDraft(proportion(6, 41, CONTRAST_TOPIC, 'mensagem')),
  ...firstContactChecks(AGENCY).map(approachDraft),
  ...baseDraftChecks(130).map(approachDraft),
];

export const APPROACH_CASES: ApproachCase[] = [
  {
    id: 'pedido-sem-fonte',
    synthetic: true,
    // A loja nova está só no PEDIDO (a hipótese do Instagram não chega à IA): não tem fonte.
    input: PEDIDO_SEM_FONTE,
    checks: [
      {
        // O erro real: "Em que se apoia" mostrava o fato de outra loja para a loja nova.
        name: 'nenhum ponto da estratégia apoia a loja do pedido em evidência',
        zeroTolerance: true,
        pass: (output) =>
          output.strategy.evidence.every((point) =>
            NEW_STORE_TERMS.every((term) => !plain(point.statement).includes(term)),
          ),
      },
      approachDraft(noSourceFor(NEW_STORE_TERMS, ANY_SOURCE, 'fonte nenhuma (veio só do pedido)')),
      approachDraft(mentions(['vila aurora'], 'cita a loja nova, como o pedido manda')),
      ...approachCommon(PEDIDO_SEM_FONTE),
    ],
  },
  {
    id: 'canal-email-sem-historia',
    synthetic: true,
    // O tipo força o e-mail: o motivo do canal não pode ser um LinkedIn que "não deu certo".
    input: CANAL_EMAIL,
    checks: [
      noInventedHistory((output) => output.strategy.channelReason, 'motivo do canal'),
      approachDraft(noSourceFor(NEW_STORE_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram')),
      approachDraft(inferenceWithCare(NEW_STORE_TERMS, 'loja nova')),
      approachDraft(mentions(NEW_STORE_TERMS, 'cita a loja nova (sem pedido)', true)),
      ...approachCommon(CANAL_EMAIL),
    ],
  },
  {
    id: 'proporcao-contraste',
    synthetic: true,
    // Diagnóstico exagerado (leitura interna) e evidência de 6 de 41: sem "grave" ao cliente.
    input: PROPORCAO,
    checks: [
      approachDraft(mentions(['contraste'], 'fala do contraste, como o pedido manda')),
      ...approachCommon(PROPORCAO),
    ],
  },
  {
    id: 'base-limitada',
    synthetic: true,
    // KI-124: base limitada, mensagem exploratória, sem revelar a avaliação interna.
    input: BASE_LIMITADA,
    checks: [
      approachDraft({
        name: 'base limitada: a mensagem pergunta',
        // Pergunta direta ou indireta ("gostaria de saber se...").
        pass: (draft) =>
          draft.body.includes('?') ||
          /\b(gostaria de saber|queria saber|quero saber|podem me (dizer|contar)|poderiam me (dizer|contar))\b/.test(
            plain(draft.body),
          ),
      }),
      approachDraft({
        name: 'não revela a leitura interna (base, lacuna, diagnóstico, hipótese)',
        zeroTolerance: true,
        pass: (draft) =>
          !/\b(base limitada|lacunas?|diagnostico|hipotese|leitura do prospector|qualificacao|prioridade|nivel de confianca)\b/.test(
            plain(draftText(draft)),
          ),
      }),
      ...approachCommon(BASE_LIMITADA),
    ],
  },
];

const REWRITE = { subject: 'Marca da PetVila nas lojas e redes', body: EDITED_BODY };

/** A reescrita não traz de volta o que o usuário tirou: a loja nova (paráfrases) e o contraste. */
const noComeback: Check<MessageDraftText> = {
  name: 'não traz de volta o que o usuário tirou (loja nova ou contraste)',
  zeroTolerance: true,
  pass: (draft) => {
    const value = plain(draftText(draft));
    return [...NEW_STORE_TERMS, ...CONTRAST_TERMS].every((term) => !value.includes(term));
  },
};

const MENSAGEM_NOVA = message({
  insights: EXAGGERATED_DIAGNOSIS,
  instruction: 'Cite a loja nova e o contraste.',
});

/** Pessoa dona do negócio (empresa individual): o nome dela não entra na mensagem. */
const PERSON = 'Ana Luíza Prado Sintética';
const INDIVIDUAL = message({
  company: {
    displayName: PERSON,
    city: 'Curitiba',
    uf: 'PR',
    cnaeMain: '7420-0/01',
    sizeBand: 'MEI',
    primaryDomain: 'estudioanaluiza.test',
    individual: true,
  },
  claims: [
    claim(
      11,
      'O site mostra o portfólio do estúdio de fotografia, com ensaios de família e de produtos.',
      'fact',
      [{ kind: 'web_page', tier: 'company_owned', host: 'estudioanaluiza.test' }],
    ),
    claim(
      12,
      'O logotipo do site é diferente do usado na assinatura das fotos.',
      'inference',
      [{ kind: 'web_page', tier: 'company_owned', host: 'estudioanaluiza.test' }],
      'brand',
    ),
  ],
  strategy: null,
});

export const MESSAGE_CASES: MessageCase[] = [
  {
    id: 'reescrita-mais-curta',
    synthetic: true,
    // O usuário tirou a loja nova; o pedido só encurta: a loja nova não pode voltar.
    input: message({ previous: REWRITE, instruction: 'Deixe mais curto e direto.' }),
    checks: [
      noComeback,
      {
        name: 'mantém o ponto principal da versão anterior (o laranja da marca)',
        // O ponto é a cor da marca que muda entre os canais ("laranja", "tons", "cor").
        pass: (draft) => /\b(laranja|tons?|cor|cores)\b/.test(plain(draft.body)),
      },
      {
        name: 'mais curta que a versão anterior',
        pass: (draft) => words(draft.body) < words(EDITED_BODY),
      },
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(120),
    ],
  },
  {
    id: 'reescrita-tom-formal',
    synthetic: true,
    input: message({
      tone: 'formal',
      previous: REWRITE,
      instruction: 'Troque o tom para mais formal.',
    }),
    checks: [
      noComeback,
      {
        name: 'mantém a cor da marca da versão anterior',
        pass: (draft) => /laranja/.test(plain(draft.body)),
      },
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(140),
    ],
  },
  {
    id: 'reescrita-acrescenta-loja',
    synthetic: true,
    // Agora o pedido manda acrescentar: entra, mas sem dizer que o site mostra (veio do Instagram).
    input: message({ previous: REWRITE, instruction: 'Acrescente a loja nova da Vila Aurora.' }),
    checks: [
      mentions(['vila aurora'], 'acrescenta a loja nova pedida'),
      noSourceFor(NEW_STORE_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram'),
      {
        name: 'não traz de volta o contraste',
        zeroTolerance: true,
        pass: (draft) => CONTRAST_TERMS.every((term) => !plain(draftText(draft)).includes(term)),
      },
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(150),
    ],
  },
  {
    id: 'mensagem-nova-fonte-e-proporcao',
    synthetic: true,
    input: MENSAGEM_NOVA,
    checks: [
      noSourceFor(NEW_STORE_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram'),
      mentions(NEW_STORE_TERMS, 'cita a loja nova, como o pedido manda'),
      mentions(['contraste'], 'cita o contraste, como o pedido manda'),
      proportion(6, 41, CONTRAST_TOPIC, 'mensagem'),
      noInventedPlace(dataText(MENSAGEM_NOVA)),
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(130),
    ],
  },
  {
    id: 'agencia-sem-nome',
    synthetic: true,
    // KI-124: sem nome da agência, só o marcador, e nenhum nome inventado.
    input: message({ agencyName: null }),
    checks: [
      {
        name: 'usa o marcador [nome da agência]',
        pass: (draft) => draft.body.includes('[nome da agência]'),
      },
      {
        name: 'não inventa nome de agência',
        zeroTolerance: true,
        pass: (draft) => {
          const text = draftText(draft)
            .replaceAll('[nome da agência]', '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          // Sem a flag i: com ela, \p{Lu} também casa minúscula ("a agência está escrevendo").
          return !/\b(?:[Ee]studio|[Aa]gencia|[Ss]tudio)\s+(?!de\b|do\b|da\b|e\b)\p{Lu}/u.test(
            text,
          );
        },
      },
      noSourceFor(NEW_STORE_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram'),
      ...baseDraftChecks(130, true),
    ],
  },
  {
    id: 'empresa-individual',
    synthetic: true,
    // KI-124: o nome da empresa é o nome de uma pessoa: não vai na saudação nem no texto.
    input: INDIVIDUAL,
    checks: [
      {
        name: 'não usa o nome da pessoa',
        zeroTolerance: true,
        pass: (draft) => !/\b(ana|luiza|prado)\b/.test(plain(draftText(draft))),
      },
      {
        name: 'saudação "Olá" sem nome',
        pass: (draft) => /^ola\b/.test(plain(draft.body)),
      },
      noInventedPlace(dataText(INDIVIDUAL)),
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(130),
    ],
  },
  {
    id: 'follow-up-sem-culpa',
    synthetic: true,
    // KI-124: follow-up depois do primeiro contato: sem cobrar e sem conversa inventada.
    input: message({ kind: 'follow_up', firstContact: false }),
    checks: [
      noSourceFor(NEW_STORE_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram'),
      {
        name: 'sem cobrar resposta nem culpa',
        pass: (draft) =>
          !/\b(nao tive retorno|sem retorno|nao obtive|ainda nao (respondeu|responderam|tive)|aguardo (seu|o|um) retorno|nao recebi|nao recebemos)\b/.test(
            plain(draft.body),
          ),
      },
      {
        name: 'sem conversa ou reunião inventada',
        zeroTolerance: true,
        pass: (draft) =>
          !/\b(como conversamos|conforme conversamos|na nossa conversa|na reuniao|como combinamos|conforme combinado|nossa ligacao|como falamos|conforme falamos)\b/.test(
            plain(draftText(draft)),
          ),
      },
      signsOff(AGENCY),
      ...baseDraftChecks(95),
    ],
  },
  {
    id: 'rodape-sem-descadastro',
    synthetic: true,
    // KI-124: com o rodapé oficial, a mensagem não escreve a própria frase de descadastro.
    input: message({
      optOutText: 'Para não receber mais mensagens, responda "sair".',
      claims: [STORES, COLORS, ACTIVE],
      strategy: { ...STRATEGY, evidence: [STRATEGY.evidence[1]!] },
    }),
    checks: [
      {
        name: 'sem frase de descadastro própria',
        zeroTolerance: true,
        pass: (draft) =>
          !/(descadastr|nao (quiser|deseja|desejar) (mais )?receber|parar de receber|responda "?sair|remover (seu|o) (e-?mail|contato)|cancelar o recebimento|nao receber mais)/.test(
            plain(draft.body),
          ),
      },
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(130),
    ],
  },
];

// --- Fora da amostra (EVAL_HOLDOUT=1): outra empresa, outros números -----------------------------

const H_SITE = 'sorrisonorte.test';
const H_AGENCY = 'Oficina Prisma';
const H_UNITS = claim(
  21,
  'O site apresenta duas unidades em Belo Horizonte: Savassi e Pampulha.',
  'fact',
  [{ kind: 'web_page', tier: 'company_owned', host: H_SITE }],
  'firmographic',
);
const H_PAGES = claim(
  22,
  'Leitura automática do site: 9 de 30 páginas ainda usam o logotipo antigo da clínica.',
  'fact',
  [{ kind: 'screenshot', tier: 'company_owned', host: H_SITE }],
  'brand',
);
/** Forma real com que um achado da pesquisa chega do ledger: busca, host do Instagram, agregador. */
const H_NEW = claim(
  23,
  'A clínica anuncia uma terceira unidade no bairro Buritis.',
  'inference',
  [{ kind: 'search_result', tier: 'aggregator', host: 'instagram.com' }],
  'growth',
);
const H_ACTIVE = claim(
  24,
  'Empresa ativa desde 2017, com sede em Belo Horizonte (MG).',
  'fact',
  [{ kind: 'api_record', tier: 'official_registry', host: null }],
  'firmographic',
);
const H_BASE: AiContext = {
  company: {
    displayName: 'Sorriso Norte Sintética',
    city: 'Belo Horizonte',
    uf: 'MG',
    cnaeMain: '8630-5/04',
    sizeBand: 'ME',
    primaryDomain: H_SITE,
    individual: false,
  },
  claims: [H_UNITS, H_PAGES, H_NEW, H_ACTIVE],
  insights: EMPTY_APPROACH_INSIGHTS,
  offer: {
    name: 'Revisão de marca e sinalização',
    description: 'Atualização da marca e aplicação nas unidades, no site e na sinalização.',
    problems: ['Logotipo antigo e novo convivendo nos canais.'],
    needSignals: ['Logotipos diferentes entre páginas do site.'],
    deliverables: ['Guia de Sinalização', 'Kit de peças para redes'],
    valueProps: ['O paciente reconhece a clínica igual em todas as unidades.'],
  },
  voice: null,
  agencyName: H_AGENCY,
  optOutText: null,
  cases: [],
};
const H_UNIT_TERMS = ['buritis', 'terceira unidade', 'unidade nova', 'nova unidade', 'inaugur'];
const LOGO_TOPIC = (sentence: string) =>
  /\blogo(tipo)? (antigo|desatualizado|anterior)\b/.test(sentence);
const H_DIAGNOSIS: AiContext['insights'] = {
  ...EMPTY_APPROACH_INSIGHTS,
  diagnosis: {
    id: ID(600),
    status: 'complete',
    summary:
      'Identidade completamente desatualizada, com logotipo antigo em quase todo o site e falhas graves de marca.',
    findings: [
      { statement: 'Problema sério: logotipo antigo na maioria das páginas.', claimIds: [ID(22)] },
    ],
    producedAt: '2026-11-24T12:00:00Z',
    promptId: null,
  },
};
const H_APPROACH: ApproachAiRequest = {
  ...H_BASE,
  basis: 'sufficient',
  gaps: [],
  firstContact: true,
  kind: 'initial_email',
  tone: 'consultative',
  instruction: 'Mencione a unidade nova do Buritis.',
};
const H_MESSAGE = (overrides: Partial<MessageAiRequest>): MessageAiRequest => ({
  ...H_BASE,
  kind: 'initial_email',
  tone: 'consultative',
  channel: 'email',
  firstContact: true,
  strategy: null,
  previous: null,
  replyTo: null,
  instruction: null,
  ...overrides,
});
const H_EDITED = [
  'Olá, equipe da Sorriso Norte!',
  '',
  'Aqui é a Oficina Prisma, de marca e sinalização. Vi no site de vocês as unidades da Savassi e da Pampulha e reparei que algumas páginas ainda mostram o logotipo antigo da clínica.',
  '',
  'Quando a marca aparece de dois jeitos, o paciente demora a reconhecer a clínica. Podemos conversar 20 minutos sobre como alinhar o site e as unidades?',
  '',
  'Abraço,',
  'Oficina Prisma',
].join('\n');
const H_DIAGNOSIS_MESSAGE = H_MESSAGE({
  insights: H_DIAGNOSIS,
  instruction: 'Fale do logotipo antigo no site.',
});

const holdoutApproach = (input: ApproachAiRequest): Check<ApproachAiOutput>[] => [
  noInventedHistory(
    (output) => `${strategyText(output)}\n${draftText(output.message)}`,
    'estratégia e mensagem',
  ),
  ...strategyChecks(dataText(input), 9, 30),
  approachDraft(noInventedPlace(dataText(input))),
  approachDraft(proportion(9, 30, LOGO_TOPIC, 'mensagem')),
  ...firstContactChecks(H_AGENCY).map(approachDraft),
  ...baseDraftChecks(130).map(approachDraft),
];

export const HOLDOUT_APPROACH_CASES: ApproachCase[] = [
  {
    id: 'fora-pedido-unidade',
    synthetic: true,
    holdout: true,
    input: H_APPROACH,
    checks: [
      approachDraft(mentions(['buritis'], 'cita a unidade do pedido')),
      approachDraft(noSourceFor(H_UNIT_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram')),
      {
        name: 'ponto da estratégia sobre a unidade nova só com a ref do Instagram',
        zeroTolerance: true,
        pass: (output) =>
          output.strategy.evidence
            .filter((point) => H_UNIT_TERMS.some((term) => plain(point.statement).includes(term)))
            .every(
              (point) =>
                point.claimIds.length > 0 &&
                point.claimIds.every((id) => id === ID(23)) &&
                !/\bsite\b/.test(plain(point.statement)),
            ),
      },
      ...holdoutApproach(H_APPROACH),
    ],
  },
];

export const HOLDOUT_MESSAGE_CASES: MessageCase[] = [
  {
    id: 'fora-diagnostico-exagerado',
    synthetic: true,
    holdout: true,
    input: H_DIAGNOSIS_MESSAGE,
    checks: [
      mentions(['logotipo antigo', 'logo antigo'], 'fala do logotipo antigo, como o pedido manda'),
      proportion(9, 30, LOGO_TOPIC, 'mensagem'),
      noSourceFor(H_UNIT_TERMS, NOT_INSTAGRAM, 'outra fonte que não o Instagram'),
      inferenceWithCare(H_UNIT_TERMS, 'unidade nova'),
      noInventedPlace(dataText(H_DIAGNOSIS_MESSAGE)),
      ...firstContactChecks(H_AGENCY),
      ...baseDraftChecks(130),
    ],
  },
  {
    id: 'fora-reescrita-encurta',
    synthetic: true,
    holdout: true,
    input: H_MESSAGE({
      previous: { subject: 'Marca da Sorriso Norte', body: H_EDITED },
      instruction: 'Deixe mais curto.',
    }),
    checks: [
      {
        name: 'não traz o que a versão anterior não tinha (unidade nova, contagem)',
        zeroTolerance: true,
        pass: (draft) => {
          const value = plain(draftText(draft));
          return (
            H_UNIT_TERMS.every((term) => !value.includes(term)) &&
            !/\b9 de 30\b|\b30 paginas\b|%/.test(value)
          );
        },
      },
      {
        name: 'mantém o ponto do logotipo antigo',
        pass: (draft) => /logo(tipo)? antigo/.test(plain(draft.body)),
      },
      {
        name: 'mais curta que a versão anterior',
        pass: (draft) => words(draft.body) < words(H_EDITED),
      },
      ...firstContactChecks(H_AGENCY),
      ...baseDraftChecks(120),
    ],
  },
];

// --- Casos da tese (diretriz 2026-11-26, Parte 5 e casos da Parte 8) --------------------------------
//
// A mensagem parte da tese aprovada, não da auditoria do site. Caso 1 (como a Flash real): um
// investimento com fonte de notícia e uma medição de contraste do site; a mensagem fala do
// movimento, nunca trata o investimento como verba e não abre pelo contraste. Caso 5: a empresa
// disse que procura o serviço (demanda explícita). Caso 4: só há medições do site e a tese manda
// não priorizar; a mensagem pergunta, sem termo técnico e sem propor reunião.

const VELOZ = 'velozpag.test';
const NEWS_SOURCE = {
  kind: 'web_page',
  tier: 'recognized_press',
  host: 'noticias-economia.test',
} as const;

const V_FUNDING = claim(
  701,
  'A Veloz Pagamentos Sintética anunciou uma rodada Série D de R$ 100 milhões, liderada pelo Fundo Horizonte Sintético, para expandir a conta digital para pequenas empresas (março de 2026).',
  'fact',
  [NEWS_SOURCE],
  'signal',
);
const V_PRODUCT = claim(
  702,
  'O site apresenta a conta digital, a maquininha e o pagamento por link para pequenos negócios.',
  'fact',
  [{ kind: 'web_page', tier: 'company_owned', host: VELOZ }],
  'positioning',
);
const V_CONTRAST = claim(
  703,
  'Medição automática do contraste: 6 de 41 amostras de texto ficaram abaixo do mínimo recomendado (WCAG AA).',
  'fact',
  [{ kind: 'screenshot', tier: 'company_owned', host: VELOZ }],
  'visual',
);
const V_ACTIVE = claim(
  704,
  'Empresa ativa desde 2016, com sede em São Paulo (SP).',
  'fact',
  [REGISTRY_SOURCE],
  'firmographic',
);

const V_ANGLE: ThesisAngle = {
  problemId: 'digital-product-structure',
  solutionId: 'brand-architecture',
  title: 'Organização da marca do produto digital',
  context:
    'Investimento ou rodada: Série D de R$ 100 milhões, com Fundo Horizonte Sintético (noticias-economia.test em março de 2026)',
  problem:
    'Hipótese a confirmar: com a expansão depois do investimento, os produtos e a marca podem precisar se apresentar de um jeito só.',
  offer: ['Arquitetura de marca', 'Sistema de identidade visual'],
  why: 'Empresas que recebem investimento para expandir costumam reorganizar produto e comunicação. Sustentado por: investimento ou rodada.',
  whyNow: 'O acontecimento é de março de 2026: confirmar se o momento ainda vale.',
  approachRole: 'Diretoria de marketing ou de produto',
  openingTopic:
    'Investimento ou rodada anunciado em março de 2026 e o que ele muda em produto e marca na Veloz Pagamentos Sintética.',
  signals: ['funding'],
  claimIds: [ID(701)],
};

const V_THESIS: SelectedThesis = {
  investigationId: ID(710),
  choice: 'principal',
  recommendation: 'approach',
  recommendationReason: 'Há um acontecimento com fonte e a solução cabe no perfil da agência.',
  angle: V_ANGLE,
  doNotOffer: [
    {
      item: 'Correção de contraste do site',
      reason: 'Medição técnica não é motivo de contato nem projeto estratégico.',
    },
  ],
  toConfirm: [
    'Quem cuida da marca depois do investimento.',
    'Se já há agência contratada para a expansão.',
  ],
};

const VELOZ_CONTEXT: Pick<
  AiContext,
  'company' | 'claims' | 'insights' | 'thesis' | 'language' | 'offer'
> = {
  company: {
    displayName: 'Veloz Pagamentos Sintética',
    city: 'São Paulo',
    uf: 'SP',
    cnaeMain: '6619-3/99',
    sizeBand: 'DEMAIS',
    primaryDomain: VELOZ,
    individual: false,
  },
  claims: [V_FUNDING, V_PRODUCT, V_CONTRAST, V_ACTIVE],
  insights: EMPTY_APPROACH_INSIGHTS,
  thesis: V_THESIS,
  language: {
    formality: 'informal',
    address: 'second_person',
    terms: ['conta', 'maquininha', 'negócio'],
    samples: 4,
  },
  offer: {
    name: 'Arquitetura de marca',
    description: 'Organização da marca, dos produtos e de como eles se apresentam juntos.',
    problems: ['Produtos que se apresentam cada um de um jeito.'],
    needSignals: ['Crescimento com produtos novos.'],
    deliverables: ['Arquitetura de marca', 'Guia de nomes e de aplicação'],
    valueProps: ['O cliente entende o que a empresa oferece e como os produtos se ligam.'],
  },
};

const FUNDING_TERMS = ['investimento', 'rodada', 'serie d', 'aporte', 'captacao', '100 milhoes'];
/** Investimento tratado como dinheiro para a agência (o erro que a tese evita). */
const BUDGET =
  /\b(verbas?|orcamentos?|recursos? (para|financeiros|novos)|tem dinheiro|dinheiro novo|caixa (para|reforcado)|podem investir|pode investir|hora de investir|momento de investir|investir (na|em) (marca|identidade|branding)|capital (para|novo))\b/;
const noBudgetTalk: Check<MessageDraftText> = {
  name: 'não trata o investimento como verba para a agência',
  zeroTolerance: true,
  pass: (draft) => !BUDGET.test(plain(draftText(draft))),
};
const SITE_MEASURE = /\b(contraste|wcag|acessibilidade|legibilidade|amostras?|desempenho|6 de 41)\b/;
const noSiteMeasure: Check<MessageDraftText> = {
  name: 'não fala de medição do site (contraste, acessibilidade, desempenho)',
  pass: (draft) => !SITE_MEASURE.test(plain(draftText(draft))),
};
const SITE_ONLY = sourcePattern(String.raw`(?:site|pagina)`);
const fundingNotFromSite = noSourceFor(FUNDING_TERMS, SITE_ONLY, 'o site (veio de uma notícia)');
const fundingMentioned = mentions(FUNDING_TERMS, 'cita o investimento (o motivo da tese)');

const TESE_INVESTIMENTO = approach(VELOZ_CONTEXT);

// Caso 5: a própria empresa disse que procura o serviço.
const AURORA = 'casaaurora.test';
const AURORA_SITE = { kind: 'web_page', tier: 'company_owned', host: AURORA } as const;
const DEMANDA = approach({
  company: {
    displayName: 'Casa Aurora Móveis Sintética',
    city: 'Joinville',
    uf: 'SC',
    cnaeMain: '3101-2/00',
    sizeBand: 'EPP',
    primaryDomain: AURORA,
    individual: false,
  },
  claims: [
    claim(
      721,
      'O site da empresa publicou que ela procura um estúdio para refazer a identidade visual antes do lançamento da nova linha de móveis.',
      'fact',
      [AURORA_SITE],
      'signal',
    ),
    claim(
      722,
      'O site apresenta móveis de madeira sob medida, com showroom em Joinville.',
      'fact',
      [AURORA_SITE],
      'positioning',
    ),
    claim(
      723,
      'Empresa ativa desde 2011, com sede em Joinville (SC).',
      'fact',
      [REGISTRY_SOURCE],
      'firmographic',
    ),
  ],
});

// Caso 4: só medições do site; a tese manda não priorizar.
const S_ANGLE: ThesisAngle = {
  problemId: 'site-readability',
  solutionId: null,
  title: 'Leitura de parte dos textos do site',
  context: 'Medição automática do contraste: 6 de 41 amostras de texto abaixo do mínimo recomendado.',
  problem: 'Hipótese a confirmar: parte dos textos do site pode ser difícil de ler.',
  offer: ['Revisão do site'],
  why: 'A medição mostra uma parte dos textos com pouco contraste. Sustentado por: medições do site.',
  whyNow: 'Medições do site não indicam momento: não há urgência a partir delas.',
  approachRole: 'Responsável pelo site ou marketing',
  openingTopic: 'Uma observação concreta do site, como pergunta, sem tratar como projeto grande.',
  signals: ['site_accessibility'],
  claimIds: [ID(2)],
};
const SO_SITE = approach({
  thesis: {
    investigationId: ID(730),
    choice: 'principal',
    recommendation: 'deprioritize',
    recommendationReason:
      'Só há detalhes técnicos do site: nenhum acontecimento dá motivo para o contato agora.',
    angle: S_ANGLE,
    doNotOffer: [
      {
        item: 'Projeto de reposicionamento',
        reason: 'Nada nas evidências indica momento de mudança de posicionamento.',
      },
    ],
    toConfirm: ['Quem cuida do site hoje.'],
  },
});

const MEETING =
  /\b(reuniao|call|chamada de video|videochamada|\d+ minutos|agendar|marcar um horario)\b/;

export const THESIS_APPROACH_CASES: ApproachCase[] = [
  {
    id: 'tese-investimento',
    synthetic: true,
    // Como a Flash real: notícia de investimento e contraste medido no site.
    input: TESE_INVESTIMENTO,
    checks: [
      approachDraft(noBudgetTalk),
      approachDraft(noSiteMeasure),
      approachDraft(fundingMentioned),
      approachDraft(fundingNotFromSite),
      {
        name: 'estratégia não trata o investimento como verba',
        pass: (output) => !BUDGET.test(plain(strategyText(output))),
      },
      {
        name: 'estratégia não abre pelo site (contraste, acessibilidade)',
        pass: (output) =>
          !SITE_MEASURE.test(plain(`${output.strategy.opportunity}\n${output.strategy.argument}`)),
      },
      {
        name: 'quem receber: marketing ou produto (o perfil da tese)',
        pass: (output) => /\b(marketing|produto)\b/.test(plain(output.strategy.counterpartRole)),
      },
      {
        name: 'o ponto sobre o investimento cita a evidência da notícia',
        pass: (output) =>
          output.strategy.evidence.some(
            (point) =>
              FUNDING_TERMS.some((term) => plain(point.statement).includes(term)) &&
              point.claimIds.includes(ID(701)),
          ),
      },
      {
        name: 'estratégia de movimentação empresarial ou oportunidade',
        informative: true,
        pass: (output) =>
          /^estrategia (de )?(movimentacao empresarial|oportunidade)/.test(
            plain(output.strategy.argument),
          ),
      },
      ...approachCommon(TESE_INVESTIMENTO),
    ],
  },
  {
    id: 'demanda-explicita',
    synthetic: true,
    // Caso 5: a empresa publicou que procura um estúdio; a resposta é direta.
    input: DEMANDA,
    checks: [
      {
        name: 'estratégia de demanda explícita',
        pass: (output) => plain(output.strategy.argument).includes('demanda explicita'),
      },
      approachDraft(
        mentions(
          [
            'procura',
            'procurando',
            'buscando',
            'busca de',
            'refazer a identidade',
            'nova identidade',
          ],
          'responde ao que a empresa disse que procura',
        ),
      ),
      approachDraft({
        name: 'não trata a demanda como hipótese ("talvez vocês precisem")',
        pass: (draft) =>
          !/\btalvez (voces )?(precis|estej|queir)|\bse (voces )?(estiverem|estao) pensando\b/.test(
            plain(draft.body),
          ),
      }),
      approachDraft(
        mentions(['lancamento', 'nova linha'], 'liga ao lançamento da nova linha', true),
      ),
      ...approachCommon(DEMANDA),
    ],
  },
  {
    id: 'tese-so-do-site',
    synthetic: true,
    // Caso 4: tese de "não priorizar", só com medições do site.
    input: SO_SITE,
    checks: [
      {
        name: 'não propõe reunião (a tese manda não priorizar)',
        pass: (output) =>
          output.strategy.objective !== 'meeting' && !MEETING.test(plain(output.message.body)),
      },
      approachDraft({
        name: 'mensagem pergunta',
        pass: (draft) => draft.body.includes('?'),
      }),
      approachDraft({
        name: 'sem termo técnico (WCAG, amostras, pixels, "6 de 41")',
        pass: (draft) => !/\b(wcag|amostras?|pixels?|6 de 41)\b/.test(plain(draftText(draft))),
      }),
      approachDraft({
        name: 'não oferece reposicionamento (está em "não oferecer")',
        zeroTolerance: true,
        pass: (draft) => !/\breposicion/.test(plain(draftText(draft))),
      }),
      approachDraft(mentions(['contraste'], 'cita o contraste', true)),
      ...approachCommon(SO_SITE),
    ],
  },
];

const V_STRATEGY: MessageAiRequest['strategy'] = {
  opportunity:
    'A Veloz anunciou uma rodada Série D para expandir a conta digital para pequenas empresas.',
  objective: 'conversation',
  counterpartRole: 'Diretoria de marketing ou de produto',
  channel: 'email',
  channelReason: 'O tipo pedido é um e-mail de apresentação.',
  argument:
    'Estratégia movimentação empresarial: a expansão depois da rodada costuma levar a organizar como os produtos se apresentam juntos.',
  evidence: [
    { statement: 'Rodada Série D de R$ 100 milhões em março de 2026.', claimIds: [ID(701)] },
  ],
  nextStep: 'Perguntar quem cuida da marca na expansão.',
  gaps: ['Quem cuida da marca depois do investimento.'],
  risks: [],
  caseIds: [],
  thesisBasis: {
    investigationId: ID(710),
    choice: 'principal',
    title: V_ANGLE.title,
    approvedAt: '2026-11-27T10:00:00Z',
  },
};

const TESE_MENSAGEM = message({ ...VELOZ_CONTEXT, strategy: V_STRATEGY });

export const THESIS_MESSAGE_CASES: MessageCase[] = [
  {
    id: 'tese-investimento-mensagem',
    synthetic: true,
    input: TESE_MENSAGEM,
    checks: [
      noBudgetTalk,
      noSiteMeasure,
      fundingMentioned,
      fundingNotFromSite,
      noInventedPlace(dataText(TESE_MENSAGEM)),
      ...firstContactChecks(AGENCY),
      ...baseDraftChecks(130),
    ],
  },
];
