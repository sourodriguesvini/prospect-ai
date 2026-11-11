import { CompanyListFilter } from '@prospector/contracts';
import type { CompanySearchReply } from '@/lib/commands';
import { companyRoutes } from '@/lib/company-routes';
import { isAppRead } from '@/lib/host';
import { getServices } from '@/server/container';
import { userContext } from '@/server/context';

/** O termo segue o mesmo contrato da busca da tela Empresas (até 120 caracteres). */
const SearchTerm = CompanyListFilter.shape.search;
const MAX_HITS = 6;

function reply(body: CompanySearchReply, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Busca de empresas da paleta de comandos (Ctrl+K): nome, razão social, CNPJ ou domínio, pelo
 * mesmo filtro da tela Empresas. Só leitura e só para as telas do app. Sem banco configurado,
 * responde lista vazia com o aviso (para "nada encontrado" não parecer que a empresa não existe).
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAppRead(request.headers.get('sec-fetch-site'))) {
    return reply({ hits: [], error: 'Só as telas do Prospector usam esta busca.' }, 403);
  }
  const parsed = SearchTerm.safeParse(new URL(request.url).searchParams.get('q') ?? '');
  if (!parsed.success) {
    return reply({ hits: [], error: 'Busca longa demais: use até 120 caracteres.' }, 400);
  }
  const query = parsed.data;
  if (query.length < 2) return reply({ hits: [] });
  try {
    const { companies } = getServices();
    if (!companies) {
      return reply({ hits: [], error: 'A busca de empresas precisa do banco configurado.' });
    }
    const list = await companies.list(userContext(), { search: query, limit: MAX_HITS });
    return reply({
      hits: list.map((company) => ({
        id: company.id,
        name: company.displayName,
        place: company.city && company.uf ? `${company.city}/${company.uf}` : null,
        isDemo: company.isDemo,
        href: companyRoutes.company(company.id),
      })),
    });
  } catch (error) {
    console.warn('[busca] empresas indisponíveis', error);
    return reply({ hits: [], error: 'Não foi possível buscar as empresas agora.' }, 503);
  }
}
