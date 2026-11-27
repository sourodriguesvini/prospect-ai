-- Oferta da Estratégia opcional na estratégia de abordagem (ADR-0021, ajuste de 27/11/2026).
--
-- A proposta da abordagem passa a sair da tese da investigação e do catálogo do perfil comercial
-- (gravada em content.proposal); escolher uma oferta da Estratégia continua possível. Migração
-- aditiva: só tira o NOT NULL das duas colunas e exige que venham juntas. Nenhuma linha muda;
-- as estratégias antigas continuam com a oferta delas. RLS, privilégios, gatilhos de versão,
-- auditoria e imutabilidade da tabela não mudam.

alter table public.approach_plans
  alter column offer_id drop not null,
  alter column offer_version_id drop not null;

alter table public.approach_plans
  add constraint approach_plans_offer_pair_check
  check ((offer_id is null) = (offer_version_id is null));

comment on column public.approach_plans.offer_id is
  'Oferta da Estratégia (opcional desde 27/11/2026, ADR-0021). Null quando a proposta sai só do '
  'perfil comercial (content.proposal).';
comment on column public.approach_plans.offer_version_id is
  'Versão da oferta da Estratégia usada; null junto com offer_id (ADR-0021).';
