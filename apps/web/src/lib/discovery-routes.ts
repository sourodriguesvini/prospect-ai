/** Endereços das telas da Descoberta (F4, ADR-0013). */
const BASE = '/descoberta';

/** Valores conhecidos de `?aviso=` (só esses viram mensagem; KI-050). */
export const DISCOVERY_NOTICES = {
  created: 'pesquisa-criada',
  alreadyRunning: 'pesquisa-ja-em-andamento',
  confirmed: 'pesquisa-confirmada',
  cancelled: 'pesquisa-cancelada',
  discarded: 'rascunho-descartado',
  retried: 'nova-tentativa',
  monitorCreated: 'monitoramento-criado',
  monitorRun: 'monitoramento-rodando',
} as const;
export type DiscoveryNotice = (typeof DISCOVERY_NOTICES)[keyof typeof DISCOVERY_NOTICES];

export const DISCOVERY_NOTICE_MESSAGES: Record<DiscoveryNotice, string> = {
  'pesquisa-criada':
    'Pesquisa na fila. Ela roda em segundo plano: você pode sair desta tela e voltar depois.',
  'pesquisa-ja-em-andamento':
    'Essa mesma pesquisa já estava na fila ou rodando: abrimos ela em vez de começar outra igual. Nenhum crédito foi gasto de novo.',
  'pesquisa-confirmada': 'Pesquisa confirmada e na fila. Ela roda em segundo plano.',
  'pesquisa-cancelada': 'Pesquisa cancelada. O que já tinha sido encontrado continua salvo.',
  'rascunho-descartado':
    'Rascunho descartado. A pesquisa não rodou: nenhuma busca foi feita e nenhum crédito foi gasto.',
  'nova-tentativa':
    'Nova pesquisa na fila com o mesmo pedido. Buscas iguais das últimas 24 horas são reaproveitadas, sem gastar crédito.',
  'monitoramento-criado':
    'Monitoramento criado. A primeira pesquisa roda no próximo horário dentro do teto diário de créditos.',
  'monitoramento-rodando': 'Pesquisa do monitoramento na fila.',
};

function withNotice(path: string, notice?: DiscoveryNotice): string {
  return notice ? `${path}?aviso=${notice}` : path;
}

export const discoveryRoutes = {
  home: BASE,
  run: (id: string, notice?: DiscoveryNotice) =>
    withNotice(`${BASE}/pesquisas/${encodeURIComponent(id)}`, notice),
  prospects: `${BASE}/empresas`,
  prospect: (id: string) => `${BASE}/empresas/${encodeURIComponent(id)}`,
  monitors: `${BASE}/monitoramentos`,
  /** Formulário de monitoramento já preenchido com um pedido (vindo de uma pesquisa). */
  newMonitor: (prefill: { request?: string; name?: string } = {}) => {
    const query = new URLSearchParams({ novo: '1' });
    if (prefill.request) query.set('pedido', prefill.request.slice(0, 500));
    if (prefill.name) query.set('nome', prefill.name.slice(0, 120));
    return `${BASE}/monitoramentos?${query.toString()}#novo-monitoramento`;
  },
  monitorsWithNotice: (notice: DiscoveryNotice) => withNotice(`${BASE}/monitoramentos`, notice),
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids da Descoberta são UUID: outro formato no endereço vira "não encontrada" (404). */
export function isDiscoveryId(id: string): boolean {
  return UUID.test(id);
}

/** Lê `?aviso=` só entre os valores conhecidos. */
export function readDiscoveryNotice(value: string | string[] | undefined): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one && one in DISCOVERY_NOTICE_MESSAGES
    ? DISCOVERY_NOTICE_MESSAGES[one as DiscoveryNotice]
    : null;
}
