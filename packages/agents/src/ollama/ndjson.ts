/**
 * Lê um corpo `application/x-ndjson` (um JSON por linha), tolerando linhas partidas entre
 * pedaços da rede e linhas vazias. Linha que não é JSON vira erro (o Ollama nunca a envia).
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
        newline = buffer.indexOf('\n');
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield JSON.parse(rest);
  } finally {
    // Consumidor parou antes do fim (cancelamento): libera a conexão.
    await reader.cancel().catch(() => undefined);
  }
}
