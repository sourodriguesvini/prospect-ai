# Documentação — Prospector

> Sistema Operacional de Inteligência Comercial (nome de trabalho). Estado: **F1 (fundação) implementada e testada localmente, sem banco real; IA-1 (Copiloto com IA local via Ollama) entregue e verificada** · 2026-11-09.
> Comece por [13 — auditoria e evolução](13-auditoria-e-evolucao.md) (diagnóstico, matriz de maturidade, lacunas e plano). O que foi e o que não foi verificado: [09](09-mvp-e-roadmap.md) e [known-issues.md](known-issues.md).
> Verificação feita nesta versão: links internos entre documentos checados por script (26 arquivos, nenhum quebrado). Revisão independente pelos subagentes revisores ainda não foi feita.

## Ordem de leitura sugerida

| # | Documento | Para quê |
|---|---|---|
| 1 | [01-prd.md](01-prd.md) | Problema, visão, princípios, métricas, escopo, critérios de sucesso |
| 2 | [08-metodologia-comercial.md](08-metodologia-comercial.md) | Como o sistema pensa: evidência, qualificação, abordagem, aprendizado |
| 3 | [02-dominios.md](02-dominios.md) | Os 17 domínios: responsabilidades, entradas/saídas, regras, qualidade |
| 4 | [04-arquitetura-de-agentes.md](04-arquitetura-de-agentes.md) | 2 agentes + capacidades de LLM + workflows; autonomia, erros, memória |
| 5 | [03-arquitetura-tecnica.md](03-arquitetura-tecnica.md) | Componentes, execução, acesso a dados, ambientes, CI/CD |
| 6 | [05-integracoes.md](05-integracoes.md) | Provedores: propósito, custo, limites, termos, riscos, veredito |
| 7 | [06-modelo-de-dados.md](06-modelo-de-dados.md) | Tabelas, RLS, retenção, índices |
| 8 | [contracts/README.md](contracts/README.md) | Contratos Zod, eventos, ferramentas de agentes |
| 9 | [07-fluxos.md](07-fluxos.md) | Fluxos de usuário e de agentes, UX e linguagem visual |
| 10 | [09-mvp-e-roadmap.md](09-mvp-e-roadmap.md) | Fatias verticais, marcos e critérios de aceite |
| 11 | [10-riscos-custos-decisoes.md](10-riscos-custos-decisoes.md) | Riscos, custos estimados, **decisões pendentes** |
| 12 | [11-qualidade-e-testes.md](11-qualidade-e-testes.md) | DoD, testes, avaliações de IA, CI |
| 13 | [12-seguranca-e-conformidade.md](12-seguranca-e-conformidade.md) | Segurança, LGPD, controles obrigatórios |
| 14 | [13-auditoria-e-evolucao.md](13-auditoria-e-evolucao.md) | Estado real do código, matriz de maturidade, gap analysis, arquitetura de IA local, plano incremental |

## Decisões arquiteturais (ADRs)

| ADR | Tema | Status |
|---|---|---|
| [0001](adr/0001-monorepo-e-fronteiras.md) | Monorepo e fronteiras entre camadas | Proposto |
| [0002](adr/0002-evidence-ledger.md) | Evidence Ledger como núcleo | Proposto |
| [0003](adr/0003-runtime-de-agentes.md) | Runtime de agentes (Messages API + Tool Runner) | Proposto; provedor padrão emendado pelo 0008 |
| [0004](adr/0004-orquestracao-duravel.md) | Orquestração durável (Trigger.dev v4) | Proposto |
| [0005](adr/0005-observabilidade.md) | Observabilidade e custos | Proposto |
| [0006](adr/0006-segredos-e-credenciais.md) | Segredos e credenciais | Proposto |
| [0007](adr/0007-uso-interno-local-sem-login.md) | **Uso interno, local, sem login e sem multiempresa** (prevalece sobre os demais docs) | Aceito |
| [0008](adr/0008-ia-local-com-ollama.md) | **IA local com Ollama como provedor padrão** (emenda o 0003) | Aceito |

## Pesquisa de viabilidade (fontes oficiais, consultadas em 2026-11-09)

| Arquivo | Tema |
|---|---|
| [research/01](research/01-dados-empresas-e-decisores.md) | Dados de empresas brasileiras, decisores e contatos |
| [research/02](research/02-pesquisa-web-visual-e-sinais.md) | Pesquisa web para agentes, auditoria visual e sinais comerciais |
| [research/03](research/03-canais-contato-e-conformidade.md) | Canais de contato e LGPD |
| [research/04](research/04-infraestrutura-e-execucao.md) | Infraestrutura, orquestração, observabilidade, segredos |

Itens marcados **[não verificado]** nas pesquisas não foram confirmados em fonte oficial e não devem ser tratados como fato.

## Configuração do Claude Code

- [`/CLAUDE.md`](../CLAUDE.md) — regras do projeto.
- Skills: `.claude/skills/` — `fatia-vertical`, `migracao-supabase`, `capacidade-ia`, `integracao-externa`, `revisao-conformidade`.
- Subagentes: `.claude/agents/` — `revisor-arquitetura`, `revisor-seguranca`, `revisor-conformidade`, `engenheiro-testes`, `avaliador-ia`, `revisor-ux`.

## Runbooks

| Runbook | Para quê |
|---|---|
| [runbooks/ambiente-local.md](runbooks/ambiente-local.md) | Instalar, rodar testes, subir Supabase local, configurar o Ollama e rodar avaliações locais |
| [runbooks/segredos.md](runbooks/segredos.md) | Inventário de variáveis, regras e rotação de chaves |

## Registro de problemas

[known-issues.md](known-issues.md) — problemas conhecidos e pendências; nunca omitidos.
