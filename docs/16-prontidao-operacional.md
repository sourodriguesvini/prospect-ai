# 16 — Prontidão operacional: inventário de dependências e integrações

> Diretriz de 2026-11-26, Parte 13 (13.5, 13.6, 13.9 a 13.11). Conferido em **2026-11-26**, neste computador, contra a configuração real: o app instalado em `D:\Prospector` (porta 3210, aberto pelo usuário; só leitura: `/api/estado`, Configurações, E-mail, Descobrir, Resultados e os registros), o `pnpm dev` em modo memória e a linha de comando. O `.env.local` não foi lido: o que depende dele foi conferido pelo que o próprio app informa.
>
> Atualizar este documento a cada mudança de infraestrutura e a cada `pnpm app:install`.

## 1. Como ler

Classes da diretriz (13.6):

| Classe | Quer dizer |
|---|---|
| **Validado** | Configurado e conferido funcionando de verdade nesta data |
| **Não validado** | Configurado, mas sem teste real recente |
| **Incompleto** | Existe e funciona em parte; o que falta está dito |
| **Não configurado** | Não existe na instalação do usuário |
| **Credencial externa** | Depende de chave, senha ou conta de terceiro |
| **Não se aplica** | Fora da arquitetura por decisão registrada |

O critério de conclusão (13.10) pede as cinco condições juntas: implementação, configuração, persistência, validação de ponta a ponta e recuperação depois de reiniciar. A coluna "13.10" diz quais delas faltam.

## 2. Inventário

### 2.1 Dados e armazenamento

| Componente | Finalidade e dependências | Configuração atual | Teste feito e resultado | Problema → correção | Classe · 13.10 |
|---|---|---|---|---|---|
| Banco (Supabase `prospector-dev`, `sa-east-1`, plano gratuito) | Tudo o que o app guarda. Depende de `SUPABASE_URL` e `SUPABASE_SECRET_KEY` no `.env.local` (só no servidor) | Conectado; migrações aplicadas | `/api/estado` do app instalado: "O banco responde e as migrações estão aplicadas" (22:32 UTC). RLS fechado para `anon`/`authenticated` coberto por `pnpm test:db` (PGlite, 137 testes) | Plano gratuito pausa o projeto depois de dias sem uso → abrir o app de vez em quando ou mudar de plano (pago: só com autorização) | Validado · completo |
| **Backup do banco** | Recuperar os dados se o projeto for apagado, pausado de vez ou corrompido | **Nenhum**. O doc 12 §7 supõe backups do Supabase Pro; o projeto está no gratuito. Não há rotina própria (`pg_dump`) | Nenhum teste de restauração | Sem backup restaurável. Saídas: (a) plano Pro, pago, com backups diários; (b) `pg_dump` semanal para `D:\Prospector-dados\backups`, que precisa da senha do Postgres (o app usa a API com a secret key, não a conexão direta). As duas dependem do usuário | **Não configurado** · bloqueio: decisão e credencial do usuário |
| Pasta de dados e capturas de marca | Guardar as imagens que sustentam a análise visual (13.2 a 13.4) | Código corrigido hoje (ADR-0015 emenda 6a): pasta `<instalação>-dados\capturas` criada pelo instalador, achada pelo app instalado e pelo `pnpm dev`, retenção de 12 meses do último uso, sem apagar imagens antigas. **No app instalado ainda não existe**: `D:\Prospector-dados` e o registro em `%LOCALAPPDATA%\Prospector` só nascem no próximo `pnpm app:install` | `pnpm dev` (memória) com mozilla.org: 7 imagens por análise (primeiras telas, rodapé nos dois tamanhos, menu aberto no celular, página interna nos dois), todas servidas pela rota com 200 e contadas em Configurações › Sistema; segunda análise reaproveitou as iguais e não apagou nada. Rodada fora do app: 10 de 10 imagens conferidas por SHA-256 num processo novo, como depois de reiniciar | Achado na validação e corrigido: a página interna escolhida era uma tela anti-robô de `support.mozilla.org` (KI-206). Pendente: reinstalar (KI-205) e validar com o banco real | Incompleto no app instalado (falta `pnpm app:install`) · validado no `pnpm dev` |
| Histórico e evidências (ledger, "Histórico de ações") | Fatos, inferências e hipóteses com fonte; registro imutável das ações | Tabelas no banco, com RLS | Testes de serviço e de banco; Resultados lê do banco (152 empresas encontradas, 8 investigadas no mês) | Fatos de telas anti-robô gravados antes de hoje continuam em vigor (KI-206) → limpeza a fazer | Validado |

### 2.2 Coleta na internet

| Componente | Finalidade e dependências | Configuração atual | Teste feito e resultado | Problema → correção | Classe · 13.10 |
|---|---|---|---|---|---|
| Navegador automatizado (Chromium do Playwright) | Renderizar páginas e capturar a marca | Chromium 1254 em `%LOCALAPPDATA%\ms-playwright` (disco C:), junto com as versões 1223 e 1234, que não são mais usadas | Capturas reais de python.org e mozilla.org hoje; testes com Chromium real (rodapé, menu, desafio anti-robô) | C: com 14 GB livres (99% usado, KI-017): as versões antigas ocupam espaço. Correção possível: `PLAYWRIGHT_BROWSERS_PATH` no D: e apagar 1223/1234 (apagar fica com o usuário) | Validado |
| Leitor de páginas | Ler o site com SSRF, termos e robots.txt conferidos | Ligado (`PROSPECTOR_PAGE_READER` padrão) | Análise real de mozilla.org; ibge.gov.br recusou e o app respeitou | Tela anti-robô virava evidência → corrigido hoje: vira "acesso recusado" (KI-206) | Validado |
| Pesquisa na internet (Tavily, plano gratuito) | Sinais, notícias, concorrentes e Descoberta | Chave presente (o app mostra o consumo); teto do app 900 créditos/mês (cota gratuita 1.000) | 75 de 900 créditos usados em novembro, lidos às 19:33 | — | Validado · credencial externa (TAVILY_API_KEY) |
| Consulta de CNPJ (OpenCNPJ, Minha Receita de reserva) | Dados da Receita | Ligada (`PROSPECTOR_CNPJ_LOOKUP` padrão), sem chave | Investigação real com o banco em 2026-11-24 vinculou CNPJ (KI-152); hoje só com dados de teste | Sem teste real hoje | Não validado (hoje) |
| Descoberta e monitoramentos | Achar empresas com sinais e acompanhar buscas salvas | Ligada (`PROSPECTOR_DISCOVERY` padrão); teto automático diário de 12 créditos (`DISCOVERY_DAILY_AUTO_CREDITS`) | 152 empresas encontradas no mês; o registro do servidor mostra 3 monitoramentos adiados hoje pelo teto diário, como deve | Qualidade, não infraestrutura: oportunidades de topo sem site oficial encontrado e pelo menos uma classificação de ramo duvidosa ("Hospital de Amor em Barretos · saúde veterinária") → entram nas Fases 2 a 4 | Validado |

### 2.3 Inteligência artificial

| Componente | Finalidade e dependências | Configuração atual | Teste feito e resultado | Problema → correção | Classe · 13.10 |
|---|---|---|---|---|---|
| Ollama (IA local) | Todas as gerações: Copiloto, investigação, Relacionamento, Descoberta | 0.40.15 em `D:\ollama`, `127.0.0.1:11434`; modelos `qwen3.5:4b` (padrão), `nemotron-3-nano:4b`, `nemotron-3.5-bolt:e4b` | `/api/estado`: no ar, nenhum modelo carregado. Resultados: 120 gerações no mês, 8 falharam | 7 gerações registradas com modelo "desconhecido" e 0 tokens (falhas antes da escolha do modelo) → conferir na revisão das métricas | Validado |
| Gateway de IA (`packages/agents`) | Fila, concorrência 1, reserva de VRAM, prompts versionados | Padrões do código; `AI_*` opcionais | Testes (346) e uso real | — | Validado |
| Avaliações (`pnpm evals`) | Promover prompt novo só com resultado | Prompts v4 e guia de voz aguardam avaliação (KI-193) | Não rodadas nesta entrega: ocupam a GPU e pedem autorização | — | Não validado · bloqueio: autorização de GPU |

### 2.4 Contato, execução e operação

| Componente | Finalidade e dependências | Configuração atual | Teste feito e resultado | Problema → correção | Classe · 13.10 |
|---|---|---|---|---|---|
| E-mail (caixa da Hostinger, SMTP e IMAP) | Enviar o que foi aprovado e ler respostas | Caixa conferida; senha guardada criptografada desde 2026-11-25 | Conferência de 2026-11-25: login SMTP e IMAP aceitos, SPF autoriza, DKIM publicado, DMARC `p=none`. Nenhum envio a empresa nesta entrega (regra 2) | DMARC só monitora → passar a `p=quarantine` depois de semanas sem problema (no DNS, com o usuário) | Validado · credencial externa (senha da caixa) |
| Fila de trabalhos e trabalhador (ADR-0011) | Investigações, Descoberta, monitoramentos e envios agendados em segundo plano | Dentro do servidor do app (`PROSPECTOR_JOB_WORKER` padrão) | O registro mostra o agendador agindo hoje | Fechar a janela encerra à força; a tarefa volta só quando o lease vence (KI-203) | Validado, com limitação |
| Agendamentos | Monitoramentos, envio agendado, retenção das capturas (novo) | Só rodam com o app aberto | Monitoramento: visto no registro. Retenção: testada em unidade e na rodada fora do app (0 vencidas) | Nada roda com o computador desligado ou o app fechado (decisão de app local, ADR-0007) | Validado · retenção só no próximo `pnpm app:install` |
| Webhooks | — | Nenhum: o app não recebe chamadas de fora (só localhost) | — | — | Não se aplica |
| Autenticação | — | Sem login por decisão (ADR-0007); a proteção é ouvir só `127.0.0.1` e recusar `Host` fora de localhost | Testes do proxy; app instalado responde só em 127.0.0.1 | Publicar o app sem antes criar login seria inseguro (regra 3a) | Não se aplica (decisão) · validado |
| Permissões | Restringir a pasta do programa e a de dados à conta do usuário | `D:\Prospector`: só a conta, SYSTEM e Administradores (conferido em 2026-11-26, KI-199). `D:\Prospector-dados`: o instalador aplica a mesma regra ao criar | Pasta do programa conferida; pasta de dados ainda não existe | Reinstalar para criar a pasta de dados (KI-205) | Validado (programa) · pendente (dados) |
| Variáveis de ambiente | Configuração do servidor | `apps/web/.env.local` (fora do git, não lido pelo agente). Obrigatórias para o uso real: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TAVILY_API_KEY`. Todas as outras têm padrão seguro; a pasta das capturas deixou de exigir variável | App instalado mostra banco e Tavily funcionando | Nenhuma configuração obrigatória escondida em exemplo ou comentário | Validado |
| Registros (logs) | Diagnosticar falhas | `D:\Prospector\logs\janela.log` (acumula), `servidor.log` e `servidor-erros.log` (recomeçam a cada abertura) | Lidos hoje: sem erro do servidor; 3 avisos de monitoramento adiado | O registro do servidor da sessão anterior se perde ao reabrir → guardar a sessão anterior com outro nome (melhoria simples, ainda não feita) | Validado, com limitação |
| Monitoramento operacional | Ver se o app está saudável | Indicadores no menu lateral (IA local, pesquisa, banco) e Configurações › Sistema; saúde da pasta de capturas (novo) | Lidos hoje no app instalado | Sem alerta fora do app (é local) | Validado · pasta de capturas só depois de reinstalar |
| Controle de custos e limites | Não gastar dinheiro nem a máquina sem querer | Tavily 900/mês no app; até 10 créditos por pesquisa da Descoberta; 12 créditos automáticos por dia; IA com uma geração por vez, fila de 3 e reserva de VRAM | Resultados: gasto no mês US$ 0,00; 75 créditos usados | — | Validado |
| Programa de desktop (Electron, ADR-0018) | Abrir o app sem terminal | Instalado em 2026-11-26 20:57 UTC a partir do commit 27583e4 com alterações não commitadas; aberto às 20:58 | Registro da janela: abriu, achou o Ollama, subiu e respondeu | Sem assinatura digital (KI-200); Electron atualizado à mão (KI-201); caminhos de desinstalação e troca com o app aberto sem teste (KI-199) | Validado, com pendências conhecidas |

## 3. Ambiente limpo (13.9)

Não houve instalação num computador limpo: só existe este computador. O que foi feito no lugar:

- **Pasta de dados nova:** a validação usou pastas que não existiam (`D:\prospector-validacao-13-7\app\capturas` e `rodada-2`); o armazenamento criou a estrutura sozinho e a rodada seguinte, num processo novo, leu tudo de volta.
- **Sem configuração escondida:** o app instalado não precisa de nenhuma variável para guardar capturas; o instalador cria a pasta, aplica a permissão e deixa o registro para o `pnpm dev`.
- **Caminhos fixos deste computador:** a instalação (`PROSPECTOR_INSTALL_DIR`, padrão `D:\Prospector`), a pasta de dados (derivada da instalação) e o Ollama (`OLLAMA_BASE_URL`) são configuráveis. O Chromium segue o padrão do Playwright.
- **Não feito:** instalar em outra pasta ou outro computador, simular falta de Node ou de Chromium e conferir as mensagens. Isso continua sem teste.

## 4. Entrega da Parte 13 (13.11)

**Problemas encontrados.**
1. A pasta das capturas nunca foi criada nem configurada: o app instalado não guardava nenhuma imagem (caso da Flash).
2. A captura nova apagava a anterior, e o dossiê perdia a imagem de fatos antigos.
3. Só havia uma imagem por tamanho de tela, sem rodapé, sem menu e sem página interna.
4. Telas anti-robô eram lidas como página do site e viravam evidência e captura.
5. O banco não tem backup restaurável.
6. O registro do servidor se perde a cada abertura.
7. Há duas versões antigas do Chromium ocupando o C:, que já está quase cheio.

**Configurações realizadas.** Pasta de dados automática (programa de desktop, instalador e `pnpm dev`), com permissão restrita e marca; retenção de 12 meses no servidor; estado da pasta em Configurações › Sistema; desinstalador que preserva os dados e avisa.

**Integrações validadas hoje.** Banco, Ollama, Tavily, Descoberta e monitoramentos, e-mail (conferência de 2026-11-25), leitor de páginas e captura com Chromium real.

**Dependências externas.**
- Supabase (plano gratuito).
- Tavily (plano gratuito, com chave).
- Hostinger (caixa de e-mail, com senha).
- OpenCNPJ e Minha Receita (sem chave).
- Electron e Chromium (baixados e conferidos pelo instalador e pelo Playwright).

**Testes executados.**
- `pnpm typecheck` (9 de 9), `pnpm lint` (fronteiras e ESLint) e `pnpm format:check`.
- `pnpm test`: 2.013 testes, todos passando.
- Validação no `pnpm dev` com sites reais.
- Rodada de persistência fora do app, com conferência por SHA-256 num processo novo.

**Funcionalidades aprovadas pelo 13.10.** Captura e armazenamento de imagens no `pnpm dev`: implementação, configuração, persistência, validação e recuperação, conferidas com o disco real e o modo memória.

**Pendentes.** As mesmas capturas no app instalado e com o banco real (KI-205), o backup do banco, a limpeza dos fatos de telas anti-robô antigos (KI-206) e o registro da parte que sumiu entre análises (KI-204).

**Bloqueios que dependem de autorização.**
1. `pnpm app:install`: leva a correção ao app instalado e cria `D:\Prospector-dados`. Fecha e reabre o Prospector, então precisa do sim do usuário.
2. Uma análise real com o banco `prospector-dev`, que grava dados do usuário.
3. Decidir o backup: plano pago ou `pg_dump` com a senha do Postgres.
4. Apagar `D:\prospector-validacao-13-7`, que guarda só imagens de validação.
5. Apagar as versões antigas do Chromium, se o usuário quiser.
