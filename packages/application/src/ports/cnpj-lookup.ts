import type { CnpjLookupFailure, CnpjProvider, CnpjRegistryRecord } from '@prospector/contracts';

export type CnpjLookupResult =
  | {
      ok: true;
      record: CnpjRegistryRecord;
      /** Quando o provedor respondeu (ISO). Resultado do cache mantém a hora da coleta original. */
      fetchedAt: string;
      /**
       * Registro SINTÉTICO (consulta de teste, só no modo memória): a empresa, a fonte e os fatos
       * gravados a partir dele levam a marca de demonstração (regra 4 do CLAUDE.md).
       */
      synthetic?: boolean;
    }
  | {
      ok: false;
      failure: CnpjLookupFailure;
      /** Último provedor tentado (null quando nenhum foi chamado). */
      provider: CnpjProvider | null;
    };

export interface CnpjLookupOptions {
  signal?: AbortSignal;
  /** Ignora o cache (nova consulta pedida pelo usuário). */
  fresh?: boolean;
}

/**
 * Consulta de CNPJ na base aberta da Receita (M2, research/05). Implementada em
 * `@prospector/integrations`; a aplicação só recebe o registro já minimizado e validado, sempre do
 * CNPJ pedido. Nunca lança por falha do provedor: devolve `ok: false` com o motivo.
 */
export interface CnpjLookup {
  lookup(cnpj: string, options?: CnpjLookupOptions): Promise<CnpjLookupResult>;
}
