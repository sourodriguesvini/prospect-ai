import {
  RESEARCH_MAX_COUNT,
  type CommercialProfile,
  type ResearchCriteria,
  type ResearchEntityKind,
  type UF,
} from '@prospector/contracts';
import { identifyCommercialProfile } from '../commercial/identify';
import { COMMERCIAL_PROFILES } from '../commercial/profiles';
import { fold, foldWithMap, originalSlice } from '../commercial/text';
import { KNOWN_CITIES, hasFoldedWord, ufsInText } from './regions';

/**
 * Interpretação por regra do pedido de pesquisa extensa (Parte 6.2 e 6.6): sem modelo, para o
 * pedido virar trabalho na hora e do mesmo jeito sempre. O que falta e não é essencial vira
 * premissa escrita; o perfil comercial é a única informação essencial (sem ele, pergunta).
 */

/** Profissões que a regra reconhece: formas do pedido e termos das consultas. */
interface Profession {
  readonly id: string;
  /** Formas no pedido (dobradas: sem acento, minúsculas). */
  readonly forms: readonly string[];
  /** Termos das consultas, o primeiro é o principal. */
  readonly terms: readonly string[];
  /** Área para "clínica de …". */
  readonly area: string;
}

const PROFESSIONS: readonly Profession[] = [
  {
    id: 'terapia-ocupacional',
    forms: ['terapeutas ocupacionais', 'terapeuta ocupacional', 'terapia ocupacional', 'tos'],
    terms: ['terapeuta ocupacional', 'terapia ocupacional'],
    area: 'terapia ocupacional',
  },
  {
    id: 'fonoaudiologia',
    forms: ['fonoaudiologos', 'fonoaudiologas', 'fonoaudiologo', 'fonoaudiologa', 'fonoaudiologia'],
    terms: ['fonoaudiólogo', 'fonoaudiologia'],
    area: 'fonoaudiologia',
  },
  {
    id: 'psicologia',
    forms: ['psicologos', 'psicologas', 'psicologo', 'psicologa', 'psicologia'],
    terms: ['psicólogo', 'psicologia'],
    area: 'psicologia',
  },
  {
    id: 'fisioterapia',
    forms: ['fisioterapeutas', 'fisioterapeuta', 'fisioterapia'],
    terms: ['fisioterapeuta', 'fisioterapia'],
    area: 'fisioterapia',
  },
  {
    id: 'psicopedagogia',
    forms: ['psicopedagogos', 'psicopedagogas', 'psicopedagogo', 'psicopedagoga', 'psicopedagogia'],
    terms: ['psicopedagogo', 'psicopedagogia'],
    area: 'psicopedagogia',
  },
  {
    id: 'nutricao',
    forms: ['nutricionistas', 'nutricionista', 'nutricao'],
    terms: ['nutricionista', 'nutrição'],
    area: 'nutrição',
  },
];

/** Verbos de busca de fato: com a profissão, bastam. */
const SEARCH_VERBS =
  /(^|[^a-z])(encontr|ache|achar|busc|busq|pesquis|list|mape|levant|procur|garimp|prospect)/;
/**
 * Pedidos genéricos ("quero", "preciso", "me dê"): só viram pesquisa com quantidade e profissão no
 * plural ("quero 100 terapeutas ocupacionais"), e nunca quando pedem texto ou explicação ("quero
 * uma mensagem para a psicóloga…", "me dê ideias de abordagem para nutricionistas").
 */
const WANT_VERBS = /(^|[^a-z])(quero|preciso|traga|me de|me da)([^a-z]|$)/;
const NOT_A_SEARCH =
  /(^|[^a-z])(mensage|abordage|exemplo|ideia|sugest|explic|texto|e-?mail|roteiro|post|conteudo|pergunta|duvida|resum)/;

export interface ResearchInterpretation {
  readonly profileId: string | null;
  readonly profileReason: 'named' | 'keywords' | 'ambiguous' | 'none';
  readonly requestedCount: number;
  readonly criteria: ResearchCriteria;
  readonly objective: string;
  readonly audience: string;
}

function professionIn(folded: string): { profession: Profession; form: string } | null {
  for (const profession of PROFESSIONS) {
    for (const form of profession.forms) {
      if (hasFoldedWord(folded, form)) return { profession, form };
    }
  }
  return null;
}

/** Quantidade pedida ("100 terapeutas", "cem"?): só número escrito em algarismos. */
function countIn(text: string): number | null {
  const match = /(?:^|[^\d])(\d{1,4})(?:\s*(?:mil))?(?=\s|$|[^\d])/.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function citiesIn(text: string): Array<{ city: string; uf: UF }> {
  const folded = fold(text);
  return KNOWN_CITIES.filter(
    ({ city, uf }) =>
      // A capital com o nome do estado (São Paulo, Rio de Janeiro) conta como estado, salvo
      // "cidade de São Paulo" ou "capital".
      hasFoldedWord(folded, fold(city)) &&
      !(['São Paulo', 'Rio de Janeiro'].includes(city) && !/cidade d[eo]|capital/.test(folded)) &&
      Boolean(uf),
  );
}

/** "para apresentar a Blummy" → "Apresentar a Blummy"; sem isso, prospecção para o perfil. */
function objectiveIn(text: string, profileName: string | null): string {
  const match = /\bpara\s+(apresentar|oferecer|divulgar|mostrar|vender)\b([^.!?\n]{0,120})/i.exec(
    text,
  );
  if (match) {
    const phrase = `${match[1]}${match[2] ?? ''}`.trim();
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }
  return profileName ? `Prospecção para ${profileName}` : 'Prospecção';
}

/**
 * Pedido de pesquisa extensa de profissionais ou organizações. null = não é esse tipo de pedido
 * (vai para o modelo, que tem as outras ferramentas).
 */
export function interpretResearchRequest(
  text: string,
  profiles: readonly CommercialProfile[] = COMMERCIAL_PROFILES,
): ResearchInterpretation | null {
  const folded = fold(text);
  const strong = SEARCH_VERBS.test(folded);
  if (!strong && !WANT_VERBS.test(folded)) return null;
  const found = professionIn(folded);
  if (!found) return null;
  if (
    !strong &&
    (NOT_A_SEARCH.test(folded) || !found.form.endsWith('s') || countIn(text) === null)
  ) {
    return null;
  }
  const { profession } = found;

  const assumptions: string[] = [];
  const identified = identifyCommercialProfile(text, profiles);
  const profile = profiles.find((item) => item.id === identified.profileId) ?? null;

  const askedCount = countIn(text);
  let requestedCount = askedCount ?? 50;
  if (askedCount === null) assumptions.push('Sem quantidade no pedido: 50 resultados.');
  if (requestedCount > RESEARCH_MAX_COUNT) {
    assumptions.push(
      `Pedido acima de ${RESEARCH_MAX_COUNT}: a pesquisa vai até ${RESEARCH_MAX_COUNT}.`,
    );
    requestedCount = RESEARCH_MAX_COUNT;
  }

  const cities = citiesIn(text);
  const stateUfs = ufsInText(text);
  const ufs = [...new Set([...stateUfs, ...cities.map((entry) => entry.uf)])];
  if (ufs.length === 0) {
    assumptions.push(
      hasFoldedWord(folded, 'brasil')
        ? 'Brasil inteiro, começando pelos estados mais populosos.'
        : 'Sem região no pedido: Brasil inteiro, começando pelos estados mais populosos.',
    );
  }

  const wantsOrganizations = /clinica|consultorio|centro|espaco|instituto|organizac/.test(folded);
  const onlyOrganizations =
    wantsOrganizations &&
    /\bso\b|\bsomente\b|\bapenas\b/.test(folded) &&
    !/profission/.test(folded);
  const entityKinds: ResearchEntityKind[] = onlyOrganizations
    ? ['organization']
    : ['person', 'organization'];
  if (!onlyOrganizations) {
    assumptions.push(
      'Profissionais e organizações (clínicas e consultórios), cada um com o papel: usuário, comprador ou influenciador.',
    );
  }

  const audience = found.form.length > 3 ? found.form : profession.terms[0]!;
  return {
    profileId: profile?.id ?? null,
    profileReason: identified.reason,
    requestedCount,
    objective: objectiveIn(text, profile?.name ?? null),
    audience: audienceLabel(text, audience),
    criteria: {
      profession: profession.terms[0]!,
      terms: [...profession.terms, `clínica de ${profession.area}`].slice(0, 6),
      entityKinds,
      ufs: cities.length > 0 && stateUfs.length === 0 ? cities.map((entry) => entry.uf) : ufs,
      priorityUfs: [],
      cities: cities.map((entry) => entry.city),
      assumptions,
    },
  };
}

/** Público como a pessoa escreveu (no original, com acento), cortado. */
function audienceLabel(text: string, foldedForm: string): string {
  const mapped = foldWithMap(text);
  const at = mapped.folded.indexOf(foldedForm);
  if (at < 0) return foldedForm;
  return originalSlice(text, mapped, at, at + foldedForm.length).slice(0, 120) || foldedForm;
}

// -----------------------------------------------------------------------------
// Mudanças pedidas depois (Parte 6.3)
// -----------------------------------------------------------------------------

export interface ResearchRevisionIntent {
  readonly priorityUfs?: UF[];
  readonly ufs?: UF[];
  readonly requestedCount?: number;
  readonly cancel?: boolean;
  /** Retomar de onde parou (pesquisa concluída sem a quantidade, ou que falhou). */
  readonly resume?: boolean;
  /** O que muda, em uma frase (para a conversa e o histórico). */
  readonly change: string;
}

/**
 * Mudança na pesquisa em andamento: "agora priorize São Paulo e Minas Gerais", "só no Paraná",
 * "quero 150", "mais 50", "pode parar". null = a mensagem não muda a pesquisa.
 */
export function interpretResearchRevision(
  text: string,
  current: {
    requestedCount: number;
    /** Profissão e termos da pesquisa: "mais 50 terapeutas" conta como quantidade. */
    terms?: readonly string[];
  },
): ResearchRevisionIntent | null {
  const folded = fold(text);
  // "não pare", "sem cancelar": negação perto do verbo não muda nada.
  const negated = (verb: string) =>
    new RegExp(`(^|[^a-z])(nao|nem|sem)\\s+(\\S+\\s+){0,2}${verb}`).test(folded);
  if (
    /(^|[^a-z])(pare|parar|cancel|interromp|chega de)([^a-z]|$)/.test(folded) &&
    !negated('(pare|parar|cancel|interromp)')
  ) {
    return { cancel: true, change: 'Pesquisa cancelada a pedido.' };
  }
  // Só o pedido de retomar ("continue", "pode continuar", "retome"); "o que continua faltando?" e
  // "continue explicando" não reabrem a pesquisa (revisão de segurança, M7).
  if (
    /(^|[^a-z])(continue|continuar|retome|retomar|recomece|siga com a pesquisa|segue a pesquisa|continua a pesquisa|continua buscando)([^a-z]|$)/.test(
      folded,
    ) &&
    !/(^|[^a-z])continue (explicando|falando|me explicando|a explicar|o texto|a mensagem)/.test(
      folded,
    ) &&
    !negated('(continu|retom)')
  ) {
    return { resume: true, change: 'Pesquisa retomada de onde parou.' };
  }
  // Região e quantidade podem vir juntas ("mais 50, agora priorize o PR"): as duas valem.
  const changes: string[] = [];
  let region: Pick<ResearchRevisionIntent, 'ufs' | 'priorityUfs'> = {};
  const ufs = ufsInText(text);
  if (ufs.length > 0 && /(prioriz|foc|comec|primeiro|antes|enfatiz)/.test(folded)) {
    region = { priorityUfs: ufs };
    changes.push(`prioridade para ${ufs.join(', ')}`);
  } else if (ufs.length > 0 && /(^|[^a-z])(so|somente|apenas|restrinj|limite)/.test(folded)) {
    region = { ufs, priorityUfs: ufs };
    changes.push(`só ${ufs.join(', ')} daqui em diante`);
  }
  let requestedCount: number | undefined;
  // O número é da pesquisa só quando não conta outra coisa: "mais 50", "mais 50 profissionais",
  // "quero 150 no total"; "quero 3 exemplos de mensagem" e "mais 2 perguntas" não mudam nada.
  const termWords = (current.terms ?? [])
    .map((term) => fold(term).split(/\s+/)[0] ?? '')
    .filter((word) => /^[a-z]{4,}$/.test(word));
  const counted = [
    'resultados?',
    'pessoas?',
    'profissionais?',
    'nomes?',
    'contatos?',
    'achados?',
    'clinicas?',
    'no total',
    'ao todo',
    ...termWords.map((word) => `${word}[a-z]*`),
  ].join('|');
  const COUNTED = String.raw`(?=\s*($|[,.;!?]|e\s|(${counted})([^a-z]|$)))`;
  const more = new RegExp(String.raw`\bmais\s+(\d{1,3})\b${COUNTED}`).exec(folded);
  const total = new RegExp(
    String.raw`(quero|aumente para|ate|total de|amplie para|chegue a)\s+(\d{1,3})\b${COUNTED}`,
  ).exec(folded);
  if (more?.[1]) {
    requestedCount = Math.min(RESEARCH_MAX_COUNT, current.requestedCount + Number(more[1]));
  } else if (total?.[2]) {
    const target = Math.min(RESEARCH_MAX_COUNT, Number(total[2]));
    if (target !== current.requestedCount) requestedCount = target;
  }
  if (requestedCount !== undefined) changes.push(`quantidade pedida passa a ${requestedCount}`);
  if (changes.length === 0) return null;
  const sentence = changes.join('; ');
  return {
    ...region,
    ...(requestedCount !== undefined ? { requestedCount } : {}),
    change: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}; o que já foi achado continua.`,
  };
}
