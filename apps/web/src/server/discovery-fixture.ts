import 'server-only';
import type { DiscoveryAi, RequestContext, WebResearchService } from '@prospector/application';
import {
  ExtractorOutput,
  InterpreterOutput,
  type WebPage,
  type WebSearchOutcome,
  type WebSearchRequestDraft,
} from '@prospector/contracts';

/**
 * Buscador e IA SINTÉTICOS da Descoberta (`PROSPECTOR_DISCOVERY=fixture`, só com
 * `PROSPECTOR_STORAGE=memory`): exercitam o motor de verdade (fila, conferência dos trechos,
 * deduplicação, triagem) sem internet, sem créditos e sem GPU. Tudo o que sai daqui é DEMO
 * (domínios `.test`, CNPJ de teste) e aparece com o selo na tela (regra 4).
 */

const SITE = 'https://www.clinicaaurora.test/';
const NEWS = 'https://noticias.exemplo.test/2026/10/clinica-aurora-nova-unidade';
const GUIDE = 'https://guia.exemplo.test/ribeirao-preto/clinicas';
const JOB = 'https://vagas.exemplo.test/vaga/analista-marketing-studio-boreal';

/** Pedido com esta expressão volta sem resultados (estado "nenhum resultado"). */
export const FIXTURE_EMPTY_TERM = 'sem resultados';

const COMPANY_RESULTS = [
  {
    rank: 1,
    url: SITE,
    title: 'Clínica Aurora | Saúde integrada em Ribeirão Preto',
    snippet: 'A Clínica Aurora atende em Ribeirão Preto/SP com consultas e exames.',
    publishedAt: null,
    score: 0.9,
  },
  {
    rank: 2,
    url: GUIDE,
    title: 'Clínicas em Ribeirão Preto - Guia Exemplo',
    snippet: 'Clínica Sorriso Pleno, Ribeirão Preto - SP. Atendimento odontológico.',
    publishedAt: null,
    score: 0.7,
  },
];

const SIGNAL_RESULTS = [
  {
    rank: 1,
    url: NEWS,
    title: 'Clínica Aurora inaugura nova unidade em Ribeirão Preto',
    snippet:
      'A Clínica Aurora anunciou a inauguração de uma nova unidade na zona sul de Ribeirão Preto em outubro de 2026.',
    publishedAt: '2026-10-05',
    score: 0.8,
  },
  {
    rank: 2,
    url: JOB,
    title: 'Vaga: Analista de Marketing - Studio Boreal - Ribeirão Preto/SP',
    snippet: 'O Studio Boreal contrata Analista de Marketing para a comunicação da marca.',
    publishedAt: '2026-11-02',
    score: 0.6,
  },
];

export function syntheticDiscoveryWeb(
  now: () => Date = () => new Date(),
): Pick<WebResearchService, 'status' | 'search' | 'readPage'> {
  return {
    async status() {
      return { search: 'enabled', pageReader: 'enabled', usage: null };
    },
    async search(_ctx: RequestContext, raw: WebSearchRequestDraft): Promise<WebSearchOutcome> {
      const query = String(raw.query ?? '');
      const results = query.toLowerCase().includes(FIXTURE_EMPTY_TERM)
        ? []
        : query.toLowerCase().includes('unidade') || query.toLowerCase().includes('vaga')
          ? SIGNAL_RESULTS
          : COMPANY_RESULTS;
      return {
        ok: true,
        provider: 'tavily',
        query,
        results: structuredClone(results),
        fetchedAt: now().toISOString(),
        fromCache: false,
        creditsCharged: 0,
      };
    },
    async readPage(_ctx: RequestContext, raw: { url: string }) {
      const page: WebPage = {
        schemaVersion: 1,
        requestedUrl: raw.url,
        url: raw.url,
        httpStatus: 200,
        contentType: 'text/html',
        title: 'Clínica Aurora',
        description: 'Saúde integrada em Ribeirão Preto.',
        lang: 'pt-BR',
        text: 'Clínica Aurora — Ribeirão Preto/SP. CNPJ 11.222.333/0001-81. Agende sua consulta.',
        truncated: false,
        contentHash: 'f'.repeat(64),
        fetchedAt: now().toISOString(),
        renderer: 'http',
        noArchive: false,
      };
      return { ok: true as const, page, fromCache: false };
    },
  } as Pick<WebResearchService, 'status' | 'search' | 'readPage'>;
}

export const syntheticDiscoveryAi: DiscoveryAi = {
  promptIds: { interpreter: 'discovery-interpreter/v1', extractor: 'discovery-extractor/v2' },
  async interpret(input) {
    const empty = input.request.toLowerCase().includes(FIXTURE_EMPTY_TERM);
    return InterpreterOutput.parse({
      summary: empty
        ? 'Pesquisa de demonstração sem resultados.'
        : 'Clínicas de Ribeirão Preto (SP) com sinais de expansão e vagas de marketing.',
      // Pedido "vazio": o setor carrega a expressão, então toda busca do plano volta sem nada.
      segment: empty ? `clínicas ${FIXTURE_EMPTY_TERM}` : 'clínicas',
      segmentTerms: ['clínica'],
      cities: ['Ribeirão Preto'],
      ufs: ['SP'],
      regionScope: 'city',
      signals: empty ? [] : ['expansion', 'hiring'],
      queries: empty
        ? [
            {
              text: `clínicas ${FIXTURE_EMPTY_TERM}`,
              purpose: 'companies',
              signal: null,
              recent: false,
            },
          ]
        : [
            { text: 'clínicas Ribeirão Preto', purpose: 'companies', signal: null, recent: false },
            {
              text: 'clínica nova unidade vaga marketing Ribeirão Preto',
              purpose: 'signals',
              signal: 'expansion',
              recent: true,
            },
          ],
    });
  },
  async extract(input) {
    const n = (url: string) => input.results.find((result) => result.url === url)?.n;
    const results: unknown[] = [];
    const companies: unknown[] = [];
    const signals: unknown[] = [];
    if (n(SITE)) {
      results.push({ result: n(SITE), kind: 'company_site' });
      companies.push({
        result: n(SITE),
        name: 'Clínica Aurora',
        officialSite: true,
        city: 'Ribeirão Preto',
        uf: 'SP',
        segment: 'Clínica médica',
        description: 'Clínica com consultas e exames.',
      });
    }
    if (n(GUIDE)) {
      results.push({ result: n(GUIDE), kind: 'directory' });
      companies.push({
        result: n(GUIDE),
        name: 'Clínica Sorriso Pleno',
        officialSite: false,
        city: 'Ribeirão Preto',
        uf: 'SP',
        segment: 'Odontologia',
        description: null,
      });
    }
    if (n(NEWS)) {
      results.push({ result: n(NEWS), kind: 'news' });
      companies.push({ result: n(NEWS), name: 'Clínica Aurora', officialSite: false });
      signals.push({
        result: n(NEWS),
        company: 'Clínica Aurora',
        type: 'expansion',
        summary: 'Anunciou uma nova unidade na zona sul de Ribeirão Preto.',
        quote: 'anunciou a inauguração de uma nova unidade na zona sul de Ribeirão Preto',
        eventDate: '2026-10',
        explicit: true,
        relevance: 'high',
        service: 'brand_identity',
        rationale: 'Nova unidade costuma pedir sinalização e materiais com a marca.',
      });
    }
    if (n(JOB)) {
      results.push({ result: n(JOB), kind: 'job_post' });
      companies.push({
        result: n(JOB),
        name: 'Studio Boreal',
        officialSite: false,
        city: 'Ribeirão Preto',
        uf: 'SP',
      });
      signals.push({
        result: n(JOB),
        company: 'Studio Boreal',
        type: 'hiring',
        summary: 'Abriu vaga de Analista de Marketing.',
        quote: 'contrata Analista de Marketing para a comunicação da marca',
        eventDate: null,
        explicit: true,
        relevance: 'medium',
        service: 'brand_identity',
        rationale: 'Vaga de marketing indica investimento em comunicação.',
      });
    }
    return ExtractorOutput.parse({ results, companies, signals });
  },
};
