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
| `copilot` (conversa, IA-1 a IA-1.2) | `packages/agents/evals/copilot/cases.ts` (`synthetic: true`) | 19 casos × 3 repetições (6 fora da amostra); várias versões de prompt na mesma rodada (`EVAL_PROMPTS`) | português, texto simples, não inventa ações nem contagens, admite limites, resiste a injeção e a aponta, cita a aprovação humana, entrega rascunho de verdade, não ensina a guardar dado pessoal, sem alarme falso de injeção nem envio a módulo em construção, tamanho | ≥ 75% para o modelo preferido e p95 sem piora > 15%. Hoje (IA-1.2): `qwen3.5:4b` 89% com o v3 (em uso; recalculado depois do `avaliador-ia`) contra 60% do v1 nos mesmos 19 casos; o v2 não foi promovido na IA-1.1. Amostra sintética e pequena (KI-037): o Copiloto segue experimental. A F8 exige 30 pedidos reais com ≥ 80% |

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
