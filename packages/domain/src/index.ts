/**
 * Regras de negócio puras (sem IO, relógio ou acaso: datas e "hoje" chegam por parâmetro).
 * F2: estratégia — ofertas, rubrica, modelo de score, ICP, cases, LIA e prontidão.
 * F3a: Evidence Ledger — validação de claims, confiança, atualidade e fontes.
 */
export * from './evidence';
export * from './strategy/drafts';
export * from './strategy/lia';
export * from './strategy/readiness';
export * from './strategy/rules';
