/**
 * Regras de negócio puras (sem IO, relógio ou acaso: datas e "hoje" chegam por parâmetro).
 * F2: estratégia — ofertas, rubrica, modelo de score, ICP, cases, LIA e prontidão.
 * F3a: Evidence Ledger — validação de claims, confiança, atualidade e fontes.
 * M2: empresas — registro da Receita transformado em fatos com trecho verificável.
 * F4: descoberta — hosts, nomes, deduplicação, sinais e triagem `discovery-triage/v1`.
 * Relacionamento (ADR-0014): opt-out, aprovação de uso, base da abordagem e atenção.
 */
export * from './company/registry';
export * from './evidence';
export * from './relationship/rules';
export * from './strategy/drafts';
export * from './strategy/lia';
export * from './strategy/readiness';
export * from './strategy/rules';
export * from './discovery';
