import 'server-only';
import type { RequestContext, WebResearchService } from '@prospector/application';
import type { WebSearchOutcome, WebSearchRequestDraft } from '@prospector/contracts';

/**
 * Buscador SINTÉTICO da pesquisa extensa do Copiloto (`PROSPECTOR_DISCOVERY=fixture`, só com
 * `PROSPECTOR_STORAGE=memory`): exercita a fila, a extração, a deduplicação e a tela de revisão sem
 * internet e sem créditos. Tudo o que sai daqui é DEMO: nomes começam com "Demo", os domínios são
 * `.test` e o telefone é 00 0000-0000; a pesquisa aparece com o selo na tela (regra 4).
 */

const WORDS = ['Alfa', 'Bravo', 'Celta', 'Dorado', 'Eco', 'Farol', 'Gaia', 'Horto', 'Iris', 'Jade'];

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function syntheticResearchWeb(
  now: () => Date = () => new Date(),
): Pick<WebResearchService, 'status' | 'search'> {
  let served = 0;
  return {
    async status() {
      return { search: 'enabled', pageReader: 'disabled', usage: null };
    },
    async search(_ctx: RequestContext, raw: WebSearchRequestDraft): Promise<WebSearchOutcome> {
      const query = String(raw.query ?? '').trim();
      // "terapeuta ocupacional São Paulo SP" → "terapeuta ocupacional São Paulo - SP"
      const placed = query.replace(/\s([A-Z]{2})$/, ' - $1');
      const index = served;
      served += 1;
      const name = `Demo ${WORDS[Math.floor(index / 10) % 10]} ${WORDS[index % 10]}`;
      return {
        ok: true,
        provider: 'tavily',
        query,
        results: [
          {
            rank: 1,
            url: `https://diretorio-demo.test/${slug(name)}-${index}`,
            title: `${name} - ${placed}`,
            snippet: `${name} atende como ${placed}. Perfil de demonstração.`,
            publishedAt: null,
            score: null,
          },
          {
            rank: 2,
            url: `https://clinica-demo-${index}.test/`,
            title: `Clínica Demo ${WORDS[index % 10]} ${index} | ${placed}`,
            snippet: `Clínica de demonstração: ${placed}. Fale conosco: (00) 0000-0000.`,
            publishedAt: null,
            score: null,
          },
        ],
        fetchedAt: now().toISOString(),
        fromCache: false,
        creditsCharged: 0,
      };
    },
  };
}
