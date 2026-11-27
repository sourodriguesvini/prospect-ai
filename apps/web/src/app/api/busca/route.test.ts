import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanySearchReply } from '@/lib/commands';

/**
 * Busca de empresas da paleta (Ctrl+K) sem Next e sem banco: o serviço de empresas é trocado por
 * um falso na raiz de composição. Cobre a recusa de outro site, o limite do termo, o aviso sem
 * banco, o selo de demonstração e a falha sem detalhe interno.
 */
const list = vi.fn();
let companies: { list: typeof list } | null = { list };

vi.mock('@/server/container', () => ({ getServices: () => ({ companies }) }));
vi.mock('@/server/context', () => ({
  userContext: () => ({ actor: { type: 'user' }, traceId: 't' }),
}));

const { GET } = await import('./route');

function get(query: string, secFetchSite: string | null = 'same-origin'): Promise<Response> {
  const headers = new Headers();
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);
  return GET(new Request(`http://127.0.0.1:3000/api/busca?q=${query}`, { headers }));
}

async function body(response: Response): Promise<CompanySearchReply> {
  return CompanySearchReply.parse(await response.json());
}

beforeEach(() => {
  companies = { list };
  list.mockReset();
});

describe('GET /api/busca', () => {
  it('devolve empresas no contrato, com link interno e o selo de demonstração', async () => {
    list.mockResolvedValue([
      { id: 'c1', displayName: 'ATELIE SINTETICO', city: 'Campinas', uf: 'SP', isDemo: true },
      { id: 'c2', displayName: 'Padaria São João', city: null, uf: null, isDemo: false },
    ]);
    const response = await get(encodeURIComponent('são'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await body(response)).toEqual({
      hits: [
        {
          id: 'c1',
          name: 'ATELIE SINTETICO',
          place: 'Campinas/SP',
          isDemo: true,
          href: '/empresas/c1',
        },
        { id: 'c2', name: 'Padaria São João', place: null, isDemo: false, href: '/empresas/c2' },
      ],
    });
    // O termo vai como foi digitado (com acento), no mesmo filtro da tela Empresas.
    expect(list).toHaveBeenCalledWith(expect.anything(), { search: 'são', limit: 6 });
  });

  it('termo curto não busca', async () => {
    expect(await body(await get('a'))).toEqual({ hits: [] });
    expect(list).not.toHaveBeenCalled();
  });

  it('termo acima de 120 caracteres é recusado', async () => {
    const response = await get('a'.repeat(121));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain('120');
    expect(list).not.toHaveBeenCalled();
  });

  it('sem banco avisa em vez de dizer que nada foi encontrado', async () => {
    companies = null;
    expect(await body(await get('padaria'))).toEqual({
      hits: [],
      error: 'A busca de empresas precisa do banco configurado.',
    });
  });

  it('falha do serviço vira 503 em pt-BR, sem detalhe interno', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    list.mockRejectedValue(new Error('connection refused at db.internal:5432'));
    const response = await get('padaria');
    expect(response.status).toBe(503);
    const text = JSON.stringify(await body(response));
    expect(text).toContain('Não foi possível buscar as empresas agora.');
    expect(text).not.toContain('5432');
  });

  it('recusa pedido disparado por outro site e aceita o sem cabeçalho', async () => {
    expect((await get('padaria', 'cross-site')).status).toBe(403);
    expect((await get('padaria', 'same-site')).status).toBe(403);
    list.mockResolvedValue([]);
    expect((await get('padaria', null)).status).toBe(200);
    expect((await get('padaria', 'none')).status).toBe(200);
  });
});
