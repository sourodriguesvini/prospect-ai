/**
 * Marcas de controle que os modelos locais usam para separar papéis e turnos (Qwen/ChatML,
 * Llama, Gemma, Mistral, raciocínio). Se o texto do usuário ou um conteúdo colado trouxer uma
 * delas, o tokenizador pode tratá-la como marca de verdade e o texto passaria a "falar" como
 * sistema ou assistente. Por isso o gateway quebra essas marcas antes de enviar ao modelo.
 */
const CONTROL_TOKEN =
  /<\|[A-Za-z0-9_.-]{1,40}\|>|<\/?think>|<(?:start|end)_of_turn>|\[\/?INST\]|\[\/?SYSTEM_PROMPT\]/g;

/**
 * Troca cada marca por uma forma visualmente igual que o tokenizador não reconhece: um espaço
 * sem largura (U+200B) depois do primeiro caractere. O texto continua legível para o modelo.
 */
export function neutralizeControlTokens(text: string): string {
  return text.replace(CONTROL_TOKEN, (token) => `${token[0]}\u200b${token.slice(1)}`);
}
