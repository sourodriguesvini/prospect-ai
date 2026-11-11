# ADR-0002 — Evidence Ledger como núcleo do conhecimento sobre prospects

- Status: **Proposto**
- Data: 2026-11-09

## Contexto

O briefing exige que qualquer conclusão diferencie fatos, hipóteses e inferências, preservando fontes, datas e confiança, e que cada recomendação seja explicável. Se cada domínio guardar conclusões em formato próprio (colunas, JSON, texto do modelo), a explicabilidade e a verificação se perdem.

## Decisão

Todo conhecimento sobre empresas, contatos e relações competitivas é armazenado como **claims** tipados em um ledger compartilhado:

- `sources` (o que foi coletado, quando, de onde, com hash e snapshot);
- `claims` (afirmação, tipo epistemológico, confiança calculada, validade, status, autoria — run, prompt, modelo);
- `claim_evidence` (trecho/região da fonte que sustenta ou contradiz);
- `claim_dependencies` (inferência → fatos).

Um único `EvidenceService` grava claims e impõe as regras: fato exige evidência; inferência exige dependências; trechos são verificados contra o conteúdo armazenado; confiança é recalculada no servidor; conflito gera `disputed`; vencimento gera `stale`.

Tabelas de domínio (ex.: `companies`, `visual_audits`, `qualification_assessments`) são **projeções** ou agregados que **referenciam** claims — scores e mensagens carregam `claim_ids`.

## Consequências

- (+) Explicabilidade uniforme na UI (um componente de evidência serve a todo o produto).
- (+) Verificação determinística de alucinação de citações.
- (+) Revalidação e monitoramento operam sobre a mesma estrutura (validade por `key`).
- (+) Aprendizado: feedback humano em claims vira sinal de qualidade por capacidade.
- (−) Volume de linhas alto; exige índices e arquivamento. Aceitável no estágio.
- (−) Modelagem de `key` precisa de governança (catálogo de chaves documentado e versionado).

## Alternativas consideradas

- Campos JSON livres por domínio: rejeitado (sem verificação, sem consistência).
- Grafo de conhecimento dedicado (banco de grafos): poder expressivo maior, mas nova infraestrutura; Postgres atende ao volume previsto.

## Emenda — implementação no M2 (2026-11-10)

Implementado com o cadastro de empresas e a consulta de CNPJ ([doc 14](../14-execucao-e-conclusao.md)):

1. Tabelas `sources`, `claims`, `claim_evidence` e `claim_dependencies` na migração `20261110170000_companies_evidence` (aplicada no `prospector-dev`); gravação só pelas RPCs `create_company` e `record_evidence`, com a auditoria na mesma transação ([ADR-0010](0010-auditoria-na-mesma-transacao.md)).
2. Claims são imutáveis: nova versão é um claim novo com `supersedes_id`, e o antigo passa a `superseded` na mesma transação. A migração `20261110180000_evidence_hardening` leva essa regra ao banco (só `status` e `reviewed_at` mudam; `superseded` e `rejected` são finais; lote conferido nas RPCs) — aplicada no `prospector-dev` em 2026-11-10, com a confirmação do usuário (KI-083).
3. O `EvidenceService` confere cada trecho no texto guardado da fonte (`quote_verified`), calcula a confiança no servidor pela categoria da fonte (provedores de CNPJ entram como `aggregator`, KI-080) e recusa lote de outra empresa.
4. Dado pessoal fica fora do ledger: em MEI e empresa individual, o nome da pessoa titular fica só em `companies` (colunas que podem ser alteradas e expurgadas, KI-084); o texto da fonte e os fatos dizem "nome da pessoa titular".
5. Ausência também é fato: quando um dado some na nova consulta, o fato antigo é substituído por um fato de ausência citando a linha "não informado"; nova consulta com o mesmo conteúdo (mesmo hash) não grava nada.
6. Em aberto: recálculo e propagação para dependentes (KI-071), o resto das conferências do KI-073 e o expurgo (KI-084).
