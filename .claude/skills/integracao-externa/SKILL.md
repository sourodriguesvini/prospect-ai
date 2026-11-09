---
name: integracao-externa
description: Adicionar ou alterar integração com provedor externo (dados de empresas, busca, captura, e-mail, agenda, etc.) no Prospector — porta, adapter, termos de uso, limites, custos, segredos e testes com respostas gravadas. Use ao criar algo em packages/integrations ou chamar uma API de terceiros.
---

# Integração externa

## 1. Verificar antes de codar (obrigatório)

- Consulte a **documentação oficial atual** (preço, limites, autenticação, termos). Não confie em memória. Registre URL e data em `docs/05-integracoes.md`.
- Checklist de termos:
  - [ ] Uso comercial permitido para prospecção/pesquisa B2B?
  - [ ] Armazenamento/cache permitido? Por quanto tempo? Exige atribuição?
  - [ ] Proíbe scraping, automação ou uso com IA?
  - [ ] Dados pessoais envolvidos? Base legal e minimização definidas (skill `revisao-conformidade`)?
  - [ ] Custo por unidade e cota gratuita conhecidos?
- Se algum item for "não sei", pare e pergunte ao usuário.

## 2. Estrutura

- **Porta** (interface) em `packages/application/ports/<capacidade>.ts` — orientada ao domínio, não ao provedor.
- **Adapter** em `packages/integrations/<provedor>/` implementando a porta.
- Validação Zod da resposta do provedor (respostas inesperadas viram erro tipado, não `undefined`).
- Normalização para os tipos do domínio + criação de `sources` com `provider`, `captured_at`, hash.

## 3. Comportamento obrigatório

- Timeout explícito; retries só para erros transitórios; respeitar `retry-after`.
- Throttle global por provedor (limite documentado) e chave de concorrência por tenant.
- Registrar custo em `provider_usage` por chamada (unidades × preço vigente).
- Cache por identificador com validade compatível com os termos.
- Segredos: chave da plataforma via variável de ambiente do servidor; credenciais por tenant via cofre (nunca em texto puro no banco, logs ou traces).
- Circuit breaker: falhas consecutivas desativam temporariamente o provedor e avisam.

## 4. Testes

- Testes de contrato com **respostas reais gravadas** (fixtures com data de gravação e indicação da fonte; dados pessoais anonimizados).
- Teste de erro: 429, 5xx, timeout, resposta inválida.
- Teste "ao vivo" opcional, desligado por padrão (`LIVE_TESTS=1`), nunca no CI padrão.

## 5. Documentar

Atualize `docs/05-integracoes.md` (propósito, auth, custo, limites, termos, riscos, alternativas) e, se for decisão relevante, crie ADR.
