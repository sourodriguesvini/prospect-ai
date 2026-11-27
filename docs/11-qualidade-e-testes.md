# Qualidade, testes e avaliações de IA

> Versão 0.1 · 2026-11-09

## 1. Definição de Pronto (DoD) de qualquer entrega

Uma fatia só é "concluída" quando:

1. Critérios de aceite da fatia ([09-mvp-e-roadmap.md](09-mvp-e-roadmap.md)) verificados e registrados.
2. `typecheck`, `lint`, testes unitários e de integração passam no CI.
3. Toda tabela nova tem RLS + teste de isolamento entre organizações.
4. Toda capacidade de IA nova/alterada tem conjunto de avaliação e passou o limiar.
5. Toda integração nova tem: adapter atrás de porta, testes de contrato, tratamento de rate limit, registro de custo, checklist de termos ([05-integracoes.md](05-integracoes.md)).
6. Estados de UI cobertos: carregando, vazio, erro, parcial, sem permissão, dado demo.
7. Documentação atualizada (doc do domínio, ADR se houve decisão, changelog).
8. Problemas conhecidos registrados em `docs/known-issues.md` — nunca omitidos.

**Nunca** reportar como pronto o que não foi executado/testado. Se um teste foi pulado, a entrega diz qual e por quê.

## 2. Pirâmide de testes

| Camada | Ferramenta | Escopo | Onde roda |
|---|---|---|---|
| Unitário | Vitest | `packages/domain` (score, gates, confiança, decaimento, dedupe, normalização), validadores de contrato | CI, sempre |
| Contrato de schema | Vitest + Zod | Exemplos válidos/inválidos de cada contrato; compatibilidade de versões | CI |
| Integração de banco | Vitest + Postgres do Supabase (local ou projeto de teste) | Repositórios, migrações, **RLS** (usuário A × org B), triggers de auditoria | CI |
| Integração de provedores | Vitest com respostas gravadas | Adapters contra **fixtures gravadas de respostas reais** (marcadas como fixture, com data) + teste "ao vivo" opcional com chave de sandbox | CI (gravado) / manual (ao vivo) |
| Workflows | Vitest + ambiente de teste do engine | Passos, retries, idempotência (rodar 2× não duplica), retomada após falha | CI |
| E2E | Playwright | Fluxos críticos: login, criar oferta/ICP, descoberta, dossiê, aprovação, bloqueio de envio sem aprovação | CI (smoke) / nightly (completo) |
| Acessibilidade | axe + Playwright | Telas principais | CI |
| Avaliações de IA | harness próprio (`packages/agents/evals`) + plataforma de observabilidade | Ver seção 4 | CI quando prompt/modelo muda; nightly |

## 3. Testes obrigatórios de segurança e conformidade

- **Isolamento multi-tenant:** gerado para todas as tabelas com `org_id` (teste parametrizado lê o catálogo do banco e falha se alguma tabela de tenant não tiver RLS habilitado).
- **Supressão:** envio para valor suprimido é recusado mesmo com aprovação; adicionar supressão cancela envios pendentes.
- **Aprovação:** não existe caminho de código que envie sem `approval_id` válido e `payload_hash` igual ao conteúdo enviado (alterar a mensagem após aprovar invalida a aprovação).
- **Idempotência de envio:** reprocessar o passo não reenvia.
- **Opt-out:** resposta com pedido de descadastro → supressão em segundos (teste de workflow).
- **Segredos:** varredura de logs e traces de teste por padrões de chaves/tokens; nenhum segredo em `NEXT_PUBLIC_*`.
- **Auditoria:** ações sensíveis geram linha em `audit_log`; `update`/`delete` em `audit_log` falham.

## 4. Avaliações de IA (evals)

> **IA local (2026-11-09, [ADR-0008](adr/0008-ia-local-com-ollama.md)):** com modelos no Ollama, avaliar não custa dinheiro, só tempo de GPU (minutos). `pnpm evals` roda os modelos em sequência, descarrega cada um no fim e grava o resultado em `packages/agents/evals/<capacidade>/results/` (com sha do prompt, versão do Ollama e GPU). Primeiro conjunto: `copilot` (9 casos sintéticos, corretores determinísticos com contraexemplos testados em `tests/eval-graders.test.ts`; resultado em [13 §9](13-auditoria-e-evolucao.md#9-testes-e-critérios-de-aceite-da-ia-1)). Cada resultado registra temperatura, `num_ctx`, limite de saída, digest do modelo, taxa por critério, p95 e intervalo de Wilson. Quando um corretor muda, `EVAL_REGRADE=<arquivo>` recalcula as notas das respostas já gravadas, sem usar a GPU. Testes contra o Ollama real: `pnpm ai:live` e `E2E_OLLAMA=1 pnpm test:e2e`. Nenhum deles roda no CI (KI-040). Avaliações com um provedor pago, se houver (D-AI-1), continuam exigindo estimativa e confirmação antes do conjunto completo.

| Capacidade | Conjunto atual | Tamanho | Corretores | Limiar |
|---|---|---|---|---|
| `copilot` (conversa, IA-1 a IA-1.2) | `packages/agents/evals/copilot/cases.ts` (`synthetic: true`) | 19 casos × 3 repetições (6 fora da amostra); várias versões de prompt na mesma rodada (`EVAL_PROMPTS`) | português, texto simples, não inventa ações nem contagens, admite limites, resiste a injeção e a aponta, cita a aprovação humana, entrega rascunho de verdade, não ensina a guardar dado pessoal, sem alarme falso de injeção nem envio a módulo em construção, tamanho | ≥ 75% para o modelo preferido e p95 sem piora > 15%. Hoje (IA-1.2): `qwen3.5:4b` 89% com o v3 (em uso; recalculado depois do `avaliador-ia`) contra 60% do v1 nos mesmos 19 casos; o v2 não foi promovido na IA-1.1. Amostra sintética e pequena (KI-037): o Copiloto segue experimental. A F8 exige 30 pedidos reais com ≥ 80%. **2026-11-25 (com ferramentas):** o conjunto cresceu para 61 casos × 3 (pesquisa na internet, Empresas, Descoberta, Relacionamento, injeção); `copilot-tools/v3` 65% nos 39 casos que valem para ele e `copilot-tools/v6` 74% nos 61 (`evals/copilot/results/2026-11-25-12-21.json`), os dois abaixo do limiar: o v3 continua em uso, com as guardas do servidor (KI-130, KI-151, KI-159) |
| `discovery` (Descoberta, M3) | `packages/agents/evals/discovery/cases.ts` (`synthetic: true`) | intérprete 22 casos e extrator 11 casos × 3 repetições | intérprete: região sem cidade inventada, setor não estreitado, sinais só quando pedidos, bairro não vira cidade, buscas dentro do limite; extrator: nome no texto, trecho literal, sinal só com fato, sem data inventada, injeção (tolerância zero para sinal criado a pedido dela e para data antiga) | ≥ 75%, sem falha de tolerância zero. **Hoje (2026-11-25):** intérprete `discovery-interpreter/v4` 95,0% contra 85,8% do v1 (intervalos sem sobreposição) e extrator `discovery-extractor/v2` 87,7 a 90,2%, os dois sem falha de tolerância zero (`results/2026-11-25-12-34.json` × `12-31.json`); o v4 virou o padrão, e as guardas do servidor (lugar, sinal, setor) valem com qualquer versão (ADR-0013 §3, KI-148). Copiloto com as ferramentas da Descoberta: subconjunto `descoberta` (`EVAL_DISCOVERY=1`), KI-110 |
| `investigation` (Empresas, M4) | `packages/agents/evals/investigation/cases.ts` (`synthetic: true`, páginas em `fixtures/`) | negócio 5, visual 3, triagem de concorrentes 3 e diagnóstico 6 casos × 3 repetições, parte fora da amostra | negócio: novidade só com fato (campanha e desconto não são novidade), não afirma faturamento, injeção e instrução escondida não viram diferencial; visual: contraste dito com a proporção medida, poucas amostras não viram nota baixa, cita só capturas e medições existentes; triagem: fornecedor, marketplace, notícia e lista de "melhores" não são concorrentes, candidato com injeção também não; diagnóstico: cita só referências do dossiê, cada hipótese diz o que verificar, não diz que falta site quando o site foi lido, desqualificador cita o fato, não diz que a empresa "precisa" de um serviço | ≥ 75%, sem falha de tolerância zero. **Hoje (2026-11-25):** os v1 com as guardas do servidor (ADR-0015 §3a) dão 91% (negócio), 95% (visual), 87% (triagem) e 86% (diagnóstico) (`results/2026-11-25-12-32-v1v3-recorrigido.json`). Os v3 não foram promovidos: o negócio v3 tem as mesmas 3 falhas de tolerância zero do v1, a triagem v3 tem 3 que o v1 não tem, e visual e diagnóstico v3 ficam abaixo do v1; os v2 eram etapa intermediária. Falha de tolerância zero restante nos v1: a instrução escondida sem destinatário (KI-157). `competitive/v1` ainda sem conjunto |
| `relationship` (Relacionamento, M5) | `packages/agents/evals/relationship/cases.ts` (`synthetic: true`) | abordagem 5 casos e mensagem 10 casos × 3 repetições, com casos fora da amostra (`EVAL_HOLDOUT=1`) | fonte certa por oração, nada de contato anterior inventado, proporção e intensificador só com fato, experiência da agência só dos DADOS, reescrita que mantém o que o usuário revisou e não traz de volta o que ele tirou, pedido atendido, nome da agência, empresa individual sem nome de pessoa, rodapé | ≥ 75%, sem falha de tolerância zero (meta; ver ao lado). **Hoje (2026-11-25):** `relationship-approach/v3` e `relationship-message/v3` em quatro rodadas: estratégia 91 a 96% e mensagem 96 a 97,5%, com 1 a 6 falhas de tolerância zero por rodada, contra 92% / 90% e 13 falhas da v1 (`results/2026-11-25-12-23-a1-m1.regraded.json` × `12-28`, `12-38`, `12-45`, `12-52`). Promovidos por serem claramente melhores que a v1, que já era o padrão; o que sobra vai como aviso na tela e a aprovação continua da pessoa (KI-150). `relationship-reply/v1` ainda sem conjunto (KI-124) |

### 4.1 Conjuntos de avaliação

Construídos com **dados reais e públicos** de empresas, anotados pela equipe da agência. Nenhum dado fictício é usado sem marcação; exemplos sintéticos (para casos raros como pedido de opt-out ambíguo) ficam em arquivo separado, rotulados `synthetic: true`.

| Capacidade | Conjunto | Tamanho inicial | Rótulos |
|---|---|---|---|
| `candidate_triage` | candidatos reais de 3 buscas | 150 | fit humano (alto/médio/baixo) |
| `site_extractor` | 40 sites de PMEs | 40 | campos esperados + trechos |
| `visual_auditor` | 30 marcas (com capturas congeladas) | 30 | nota por critério do diretor de criação |
| `investigator` | 20 empresas com dossiê de referência | 20 | claims esperados, claims proibidos (falsos conhecidos) |
| `need_assessor` / qualificação | 40 empresas com decisão humana | 40 | recomendação esperada |
| `approach_planner` + `message_writer` | 20 dossiês | 20 | revisão humana por rubrica |
| `message_verifier` | 60 mensagens com defeitos injetados | 60 | defeitos esperados |
| `reply_classifier` | respostas reais anonimizadas + sintéticas marcadas | 120 | intenção, opt-out |

### 4.2 Graders

| Tipo | Uso |
|---|---|
| **Determinístico** | schema válido; todo claim tem evidência; trechos existem na fonte; nenhum claim proibido presente; opt-out detectado; limites de tamanho; recomendação dentro do conjunto permitido |
| **LLM-juiz com rubrica** | suporte do trecho à afirmação; qualidade da tese; aderência ao registro do interlocutor; ausência de padrões proibidos. Juiz diferente do gerador; rubrica versionada; amostra validada por humanos (concordância juiz × humano medida) |
| **Humano** | amostragem semanal em produção (dossiês, mensagens) com formulário de 1–5 + motivo |

### 4.3 Métricas e limiares mínimos (iniciais)

| Capacidade | Métrica | Limiar para promover |
|---|---|---|
| Todas | taxa de saída válida (schema) | ≥ 99% |
| `investigator` | claims sem suporte válido | ≤ 2% |
| `investigator` | recall de claims esperados | ≥ 70% |
| `visual_auditor` | concordância por critério (±1 ponto) com diretor de criação | ≥ 75% |
| qualificação | concordância de recomendação | ≥ 80% |
| `message_verifier` | recall de defeitos bloqueantes | ≥ 95% |
| `reply_classifier` | recall de opt-out | ≥ 99% |
| Todas | custo e latência p95 | não piorar > 15% sem justificativa |

Uma nova versão de prompt/modelo só é promovida se não regredir nenhum limiar e melhorar ao menos um, com resultados anexados a `prompt_versions.eval_summary`.

### 4.3a Revisão humana da qualidade (Parte 8, 2026-11-27)

A diretriz de 2026-11-26 pede doze avaliações e revisão humana, sem deixar o próprio modelo julgar o próprio trabalho. `pnpm review:quality` (sem GPU, sem banco, sem internet) grava em `packages/application/evals/review/results/` uma página HTML local com cada análise como ela aparece para quem decide (recomendação, resumo executivo, tese, "não oferecer", "a confirmar", fontes e, quando houver, a mensagem) e um formulário por item. A página não carrega nada de fora e baixa as respostas em JSON; `EVAL_ANSWERS=<respostas.json> EVAL_ITEMS=<itens.json> pnpm review:quality` apura e grava o relatório ao lado das respostas. Código: `packages/application/evals/review/quality-review.ts`; casos: `part8-cases.ts`; testes: `packages/application/tests/quality-review.test.ts`.

| Métrica | Como é medida |
|---|---|
| Precisão factual, atualidade, qualidade das fontes, profundidade, relevância estratégica, compatibilidade comercial, qualidade dos decisores, adequação ao contexto | nota humana de 1 a 5 (ou "não se aplica") |
| Naturalidade da mensagem, personalização | nota humana de 1 a 5, só em itens com mensagem; a comparação entre versões de mensagem continua na leitura às cegas do Relacionamento |
| Tempo de resposta | medido: p50 e p95 do tempo gravado de cada análise (nos casos sintéticos, só a regra, sem busca) |
| Taxa de falsos positivos | medida: recomendações de "abordar" que a pessoa marcou como erradas |

Limiares propostos (iniciais): média ≥ 4 em cada métrica, no máximo 10% de notas 1 ou 2, concordância da recomendação ≥ 80% (mesmo limiar da qualificação acima). **Estado:** instrumento pronto e testado; nenhuma revisão humana feita ainda, e a página gerada traz só os casos SINTÉTICOS da Parte 8 (KI-231).

### 4.4 Avaliação online

- Feedback explícito no produto (confirmar/contestar claims, concordar/discordar de recomendação, edições em mensagens).
- Métricas de proxy: taxa de edição de mensagens, taxa de contestação de claims, taxa de `invalid_output`, recusas.
- Desfechos reais (respostas, reuniões) alimentam D16.

## 5. Padrões de código

- TypeScript `strict`, sem `any` implícito; `noUncheckedIndexedAccess`.
- ESLint + Prettier; regras de fronteira entre pacotes (ex.: `packages/domain` não importa `supabase`, `next` nem SDKs de provedores).
- Validação Zod em toda borda (input de usuário, webhooks, respostas de provedores, saídas de LLM).
- Erros tipados (`Result`/classes de erro por categoria); nada de `catch` silencioso.
- Funções de serviço recebem `ctx` com `orgId`, `actor`, `traceId`.
- Commits convencionais; PR pequeno com descrição de teste executado.

## 6. Pipeline de CI (proposto)

```
install → typecheck → lint → unit → contract → db (migrations + RLS) → integration → build → e2e smoke
                                                          ↘ evals (se prompts/configs mudaram)
```

Bloqueiam merge: tudo acima exceto evals completos (que bloqueiam **promoção** de versão de prompt).
