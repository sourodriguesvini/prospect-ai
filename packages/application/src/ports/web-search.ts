import type {
  WebSearchFailure,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@prospector/contracts';

/** Falhas que só o provedor produz; as demais (desligada, orçamento, fila) são da aplicação. */
export type WebSearchProviderFailure = Extract<
  WebSearchFailure,
  'quota_exceeded' | 'rate_limited' | 'unauthorized' | 'unavailable' | 'invalid_response'
>;

export type WebSearchProviderResult =
  | {
      ok: true;
      results: WebSearchResult[];
      /** Créditos que o provedor informou ter cobrado (ou o custo nominal, se não informou). */
      creditsCharged: number;
    }
  | {
      ok: false;
      failure: WebSearchProviderFailure;
      /**
       * Créditos que podem ter sido cobrados mesmo com a falha (ex.: resposta perdida por tempo
       * esgotado). Na dúvida, o adaptador informa o custo nominal: o orçamento erra para menos.
       */
      creditsCharged: number;
      retryAfterSeconds: number | null;
    };

/**
 * Busca na internet por um provedor (D-AI-4, ADR-0012). Orientada à capacidade, não ao
 * fornecedor: trocar a Tavily por outro buscador, ou combinar dois (reserva), é implementar esta
 * interface de novo. Implementações em `@prospector/integrations` validam a resposta com Zod,
 * nunca lançam por falha do provedor e nunca registram a chave em log.
 */
export interface WebSearch {
  readonly provider: WebSearchProvider;
  /** Custo de uma busca antes de fazê-la, usado para reservar o orçamento. */
  readonly creditsPerSearch: number;
  search(
    request: WebSearchRequest,
    options?: { signal?: AbortSignal },
  ): Promise<WebSearchProviderResult>;
}

/** Uma chamada ao provedor, para o controle de consumo (`provider_usage`). */
export interface WebResearchUsageEntry {
  provider: WebSearchProvider;
  operation: 'search';
  /** Créditos contados para esta chamada (0 = provedor não cobrou). */
  units: number;
  /** Mês civil no fuso da agência (AAAA-MM), base do orçamento mensal. */
  period: string;
  /** `ok` ou o código da falha. */
  outcome: 'ok' | WebSearchProviderFailure;
  traceId: string;
  occurredAt: string;
}

/**
 * Consumo de créditos por provedor e mês. Só inclusão: o orçamento é a soma do mês. Precisa
 * sobreviver a reinícios do app, senão o limite zera a cada `pnpm dev` (implementação no banco:
 * tabela `provider_usage`, migração 20261110190000).
 */
export interface WebResearchUsageStore {
  creditsUsed(provider: WebSearchProvider, period: string): Promise<number>;
  record(entry: WebResearchUsageEntry): Promise<void>;
}
