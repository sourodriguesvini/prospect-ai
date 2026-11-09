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
