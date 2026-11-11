import { stripAccents } from './names';

/**
 * Texto de terceiros que tenta dar ordens ao modelo (injeção de prompt). Resultado de busca assim
 * não é fonte de empresa nem de sinal: o motor da Descoberta nem o mostra ao extrator. A lista é
 * de expressões típicas (português e inglês); falso positivo só custa um resultado a menos.
 */
const PATTERNS: readonly RegExp[] = [
  /\b(ignore|ignora|ignorem|desconsidere|desconsiderem|esqueca|esquecam)\b[^.]{0,40}\b(instrucoes|instrucao|regras|orientacoes|comandos|prompt)\b/,
  /\bignore\b[^.]{0,30}\b(previous|prior|above|all)\b[^.]{0,20}\b(instructions|rules|prompts?)\b/,
  /\b(disregard|forget)\b[^.]{0,30}\b(instructions|rules|prompts?)\b/,
  /\b(system prompt|prompt do sistema|you are now|voce agora e|a partir de agora voce)\b/,
  /\b(liste|inclua|cadastre|recomende|classifique)\b[^.]{0,30}\b(a empresa|esta empresa|a agencia)\b[^.]{0,80}\bcomo\b[^.]{0,40}\b(cliente|prioridade|alta|ideal|confirmad)/,
  /\b(assistente|modelo|ia|ai|llm)\b[^.]{0,20}\b(deve|precisa|must|should)\b[^.]{0,40}\b(responder|listar|classificar|answer|list)\b/,
];

export function looksLikeInstruction(text: string): boolean {
  const normalized = stripAccents(text).toLowerCase().replace(/\s+/g, ' ');
  return PATTERNS.some((pattern) => pattern.test(normalized));
}
