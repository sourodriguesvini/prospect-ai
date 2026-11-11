/**
 * Abertura do servidor (Next.js): inicia o trabalhador da fila da Descoberta (ADR-0011), para as
 * pesquisas pendentes e os monitoramentos voltarem a rodar assim que o app abre, mesmo antes de
 * alguém abrir uma tela. Só no runtime Node (o trabalhador usa o banco e a IA local).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureDiscoveryWorker } = await import('./server/container');
  ensureDiscoveryWorker();
}
