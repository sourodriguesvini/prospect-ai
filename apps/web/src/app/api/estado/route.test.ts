import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusView } from '@/lib/system-status';

/**
 * Indicadores do rodapé sem Next, sem Ollama e sem banco: os serviços são trocados por falsos na
 * raiz de composição. Cobre a recusa de outro site, a leitura que falha sem derrubar as outras,
 * o erro de configuração dos serviços e o reaproveitamento da leitura entre abas.
 */
const databaseStatus = vi.fn();
const researchStatus = vi.fn();
const aiStatus = vi.fn();
let servicesError: Error | null = null;
let withResearch = true;

vi.mock('@/server/container', () => ({
  getServices: () => {
    if (servicesError) throw servicesError;
    return {
      system: { databaseStatus },
      research: withResearch ? { status: researchStatus } : null,
    };
  },
  getLocalAi: () => ({ status: aiStatus }),
}));
vi.mock('@/server/context', () => ({
  userContext: () => ({ actor: { type: 'user' }, traceId: 't' }),
}));

const { GET } = await import('./route');

const memo = globalThis as typeof globalThis & { __prospectorSystemStatus?: unknown };

function get(secFetchSite: string | null = 'same-origin'): Promise<Response> {
  const headers = new Headers();
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);
  return GET(new Request('http://127.0.0.1:3000/api/estado', { headers }));
}

async function values(response: Response): Promise<Record<string, string>> {
  const view = SystemStatusView.parse(await response.json());
  return Object.fromEntries(view.indicators.map((item) => [item.id, item.value]));
}

const OFFLINE = {
  state: 'offline',
  provider: 'ollama',
  code: 'runtime_unavailable',
  message: 'O Ollama não está respondendo.',
  gpu: null,
};

beforeEach(() => {
  delete memo.__prospectorSystemStatus;
  servicesError = null;
  withResearch = true;
  databaseStatus.mockReset().mockResolvedValue('ok');
  researchStatus
    .mockReset()
    .mockResolvedValue({ search: 'disabled', pageReader: 'enabled', usage: null });
  aiStatus.mockReset().mockResolvedValue(OFFLINE);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('GET /api/estado', () => {
  it('junta IA local, pesquisa e banco no contrato, sem cache no navegador', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await values(response)).toEqual({
      'ia-local': 'Fora do ar',
      pesquisa: 'Desligada',
      banco: 'Conectado',
    });
  });

  it('uma leitura que falha não derruba as outras', async () => {
    databaseStatus.mockRejectedValue(new Error('timeout'));
    expect(await values(await get())).toEqual({
      'ia-local': 'Fora do ar',
      pesquisa: 'Desligada',
      banco: 'Não conferido',
    });
  });

  it('erro de configuração dos serviços mantém o indicador da IA local', async () => {
    servicesError = new Error('PROSPECTOR_CNPJ_LOOKUP inválido');
    const response = await get();
    expect(response.status).toBe(200);
    expect(await values(response)).toEqual({
      'ia-local': 'Fora do ar',
      pesquisa: 'Não conferido',
      banco: 'Não conferido',
    });
    expect(JSON.stringify(await (await get()).json())).not.toContain('PROSPECTOR_CNPJ_LOOKUP');
  });

  it('sem o serviço de pesquisa (sem banco), diz que falta o banco', async () => {
    withResearch = false;
    expect((await values(await get())).pesquisa).toBe('Sem banco');
  });

  it('abas abertas ao mesmo tempo reaproveitam a mesma leitura', async () => {
    await get();
    await get();
    expect(aiStatus).toHaveBeenCalledTimes(1);
    expect(databaseStatus).toHaveBeenCalledTimes(1);
  });

  it('recusa pedido disparado por outro site, sem ler nada', async () => {
    const response = await get('cross-site');
    expect(response.status).toBe(403);
    expect(aiStatus).not.toHaveBeenCalled();
  });
});
