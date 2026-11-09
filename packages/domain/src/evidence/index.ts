/**
 * Evidence Ledger (ADR-0002; docs/08 §2): validação de claims, classificação de fontes, cálculo
 * de confiança, atualidade e `stale`. Puro: relógio e listas de configuração por parâmetro.
 */
export * from './confidence';
export * from './policy';
export * from './sources';
export * from './validation';
