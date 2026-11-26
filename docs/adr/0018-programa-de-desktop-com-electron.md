# ADR-0018 — Programa de desktop do Prospector com Electron

- Status: **Proposto** (2026-11-26)
- Data: 2026-11-26
- Depende de: [ADR-0001](0001-monorepo-e-fronteiras.md) (fronteiras), [ADR-0007](0007-uso-interno-local-sem-login.md) (só localhost, sem login), [ADR-0008](0008-ia-local-com-ollama.md) (Ollama), runbook [ambiente-local §7](../runbooks/ambiente-local.md) e KI-075 (app instalado), KI-017 (disco C: quase cheio).

## Contexto

O app instalado (`pnpm app:install`, `D:\Prospector`) abria pelo atalho um `iniciar.ps1` que subia o servidor Next em `127.0.0.1:3210` e abria o Chrome (ou o Edge) com `--app=http://127.0.0.1:3210/`. O usuário vê isso como "uma tela do Chrome, uma extensão" e pediu um programa de verdade, "como se eu fosse abrir o Claude, um Figma, um jogo": janela própria com ícone na barra de tarefas, sem o navegador.

Outros pontos do jeito antigo: fechar a janela não desligava o servidor (precisava do atalho "Parar Prospector"); a janela era do perfil do navegador do usuário (extensões, histórico, cache no C:); o atalho abria um PowerShell escondido antes da janela.

Restrições: disco C: quase cheio (14 GB livres, KI-017), D: com 400 GB; Node 24 e pnpm já instalados (o Prospector é desenvolvido neste computador); a captura de páginas usa o Chromium do Playwright (ADR-0012, KI-091); o app não pode ser publicado (ADR-0007, regra 3a).

## Opções

| | **Electron** (escolhido) | **Tauri 2** |
|---|---|---|
| Motor da janela | Chromium próprio, da versão fixada (o mesmo motor dos e2e do Playwright) | WebView2 do Windows (Edge, atualizado pelo Windows) |
| Ferramentas para gerar o programa | nenhuma nova: Node e pnpm, que já existem | Rust (rustup) e Visual Studio Build Tools (MSVC), uns 6 a 8 GB, parte no C: |
| Tamanho em disco do programa | ~150 MB de download e ~400 MB instalado, tudo em D: | ~10 MB, mais o WebView2 que já vem no Windows 11 |
| Servidor Next | continua no Node 24 do sistema; o Electron 45 também traz Node 24.22 | precisa do Node do sistema do mesmo jeito (programa "sidecar") |
| Linguagem da janela | TypeScript, como o resto do monorepo | Rust no processo principal |
| Licença | MIT (Electron); Chromium BSD e terceiros, em `LICENSES.chromium.html` | MIT ou Apache-2.0 |
| Quem usa | Claude, Figma, Slack, VS Code | apps menores |

O tamanho do Electron pesa menos que o toolchain do Tauri: os 400 MB ficam em D:, que tem folga, e nada novo vai para o C:. O Tauri economizaria disco no programa, mas exigiria instalar Rust e MSVC só para gerar a janela, e o servidor continuaria precisando do Node. Ficar no TypeScript também mantém a janela testável com o Vitest, como o resto do código.

## Decisão

1. **Electron 45 (45.3.1), fixado** em `apps/desktop/package.json`. Atualizar é trocar a versão e rodar `pnpm app:install` (baixa o zip novo).
2. **Pacote `apps/desktop` (`@prospector/desktop`).** Só a janela: não importa nenhum pacote do Prospector e fala com o app por HTTP em `127.0.0.1:3210`. O código dela só importa `electron`, módulos `node:*` e os próprios arquivos (ESLint e `scripts/check-boundaries.mjs`): ela roda com a conta do usuário, então biblioteca nova passa por esta decisão antes. Lógica sem Electron (endereços, telas, processos, ciclo de vida do servidor, estado da janela, atalhos) em módulos testados com Vitest; os caminhos usam `path.win32`, para os testes valerem também no CI em Linux. `main.ts`, `menus.ts` e `seguranca.ts` usam o Electron.
3. **O binário não entra no repositório nem no C:.** No repositório, o pacote npm `electron` entra só como devDependency, para os tipos e o `checksums.json`; o pnpm 11 não roda o script de instalação dele, então o binário nunca é baixado para `node_modules`. O instalador (`apps/desktop/scripts/empacotar.mjs`) baixa o zip oficial do GitHub para `<instalação>\cache` uma vez por versão (o download parado por 60 s é cancelado), confere o SHA-256 com o `checksums.json` (fixado no `pnpm-lock.yaml`) e extrai em `<instalação>\programa.novo` com o `tar` do Windows. Ficam só os idiomas `en-US`, `pt-BR` e `pt-PT`; o app de exemplo do Electron sai.
   - **Ordem da instalação** (`scripts/app/instalar.mjs`): protege a pasta (item 8), gera o build e monta `programa.novo` e `app.novo` com o Prospector instalado ainda aberto; só então roda o `parar.ps1` e troca as duas pastas por renomeação. Se alguma renomeação falhar (arquivo em uso), o que já foi trocado volta e a versão anterior continua inteira; a antiga só é apagada depois que as duas novas entraram. Arquivos de instalações antigas (`iniciar.ps1`) saem depois dos atalhos novos.
4. **Executável próprio.** `electron.exe` vira `Prospector.exe`, com o ícone e os textos do Prospector (nome no Gerenciador de Tarefas e na barra) gravados com `resedit` (MIT). A assinatura digital do Electron se perde com essa edição; o Smart App Control está desligado neste computador. Travas do binário (`@electron/fuses`, MIT): não roda como Node (`ELECTRON_RUN_AS_NODE`), ignora `NODE_OPTIONS` e `--inspect`, cookies cifrados, sem privilégios extras para `file://`. As travas de integridade do ASAR (`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`) ficam desligadas de propósito: a janela vai como pasta (`resources\app`), sem `.asar`, e quem a protege contra troca é a permissão da pasta (item 8). Ligá-las exigiria empacotar em ASAR e gravar o hash no executável a cada instalação.
5. **Servidor no Node 24 do sistema**, como no `pnpm dev`, nos testes e nos e2e. O Node embutido no Electron (24.22) poderia rodar o servidor e dispensar o Node do sistema, mas exigiria deixar a trava `RunAsNode` desligada e acoplaria a versão do servidor à do Electron. A janela procura o `node.exe` no `PATH` (ou em `Program Files\nodejs`) e recusa versão abaixo da 24 com mensagem em pt-BR.
6. **Ciclo de vida.**
   - Uma instância só: abrir de novo traz a janela para a frente.
   - Ao abrir: tela "Abrindo o Prospector" (página própria, sem script); abre o Ollama se a porta dele não aceitar conexão (como o `iniciar.ps1`; a janela só testa a porta e não chama a API, ADR-0008); sobe `node app\apps\web\server.js` em `127.0.0.1:3210` com o PID em `servidor.pid` (o mesmo arquivo do `parar.ps1`) e espera até 90 s.
   - Porta ocupada: se quem ouve é o servidor deste Prospector (`node.exe` cujo único argumento é o `server.js` desta instalação; `node outro.js ...\server.js` não passa), a janela o reaproveita; se é outro programa, mostra qual e não mexe nele. A mesma conferência vale quando a porta passa a responder durante a abertura: se quem responde não é o servidor que a janela subiu, ela encerra o dela e avisa.
   - Um servidor reaproveitado que parou de responder é conferido de novo e encerrado antes de subir outro (sem isso o novo não conseguiria a porta).
   - Erros em pt-BR: instalação incompleta (sem "Tentar de novo": precisa reinstalar), Node ausente ou antigo, porta ocupada, servidor que parou ao iniciar, não respondeu ou caiu durante o uso, tela que falhou ao carregar.
   - **Fechar a janela encerra o servidor que ela subiu ou reaproveitou** (com o que ele abriu, como o Chromium da captura). O servidor reaproveitado é conferido de novo pelo nome e pela linha de comando antes. O servidor é filho da janela sem `detached`, e o Windows põe os filhos do Electron e do Node num job que fecha junto: se a janela cair, o servidor cai junto; encerrar o `node.exe` derruba o que ele abriu. Por isso a janela e o `parar.ps1` encerram só o PID conferido, sem `taskkill /T` (que segue o PID do pai gravado no Windows e poderia acertar um programa alheio com PID reaproveitado). O encerramento é forçado: o servidor não recebe aviso para terminar a tarefa da fila em andamento, que volta pelo lease vencido (KI-203). O Ollama abre separado e continua aberto.
   - Clicar no atalho enquanto o Prospector fecha reabre o programa quando o fechamento termina.
7. **Segurança da janela.**
   - Navega só em `http://127.0.0.1:3210` e nas próprias telas de carregamento e erro. As páginas do app ainda carregam o que a CSP delas permite de fora: a prévia do e-mail mostra as imagens `https` da assinatura (ADR-0016, `img-src https: data:` só nessa prévia). Esse é o conteúdo externo que chega ao Chromium da janela.
   - `contextIsolation`, `sandbox` e `webSecurity` ligados, `nodeIntegration` desligado, sem preload, sem `<webview>`.
   - Navegação para fora, redirecionamento para fora e `window.open` com endereço de fora vão para o navegador do sistema (só `http`, `https` e `mailto`, sem usuário e senha no endereço); os demais esquemas (`file:`, `javascript:`, protocolos de programas) são recusados. Um quadro interno (`iframe`) que tenta navegar para fora é só bloqueado e registrado, sem abrir o navegador: quem decide abrir um link é a pessoa, não o conteúdo de um quadro. Páginas do próprio app abertas em nova janela (a imagem inteira da captura) abrem noutra janela do Prospector, com as mesmas travas.
   - Nenhuma permissão do navegador (câmera, microfone, localização, notificações), exceto copiar texto a pedido do próprio app.
   - A CSP e a checagem de host e origem do proxy continuam valendo: a janela é um cliente como o navegador.
   - Nada de publicar o programa nem de atualização automática: ele é montado neste computador por `pnpm app:install`.
8. **Pasta da instalação fechada e perfil da janela em D:.**
   - O instalador tira a herança de permissões da pasta de instalação e deixa acesso só para a conta do usuário, o SYSTEM e os Administradores (pelos SIDs, que não mudam com o idioma do Windows), como no `%LOCALAPPDATA%`, e confere o resultado antes de copiar qualquer coisa. Sem isso a pasta herdava do `D:\` a permissão de "Usuários autenticados" alterarem arquivos: outra conta deste computador leria a chave do banco (`app\apps\web\.env.local`) e poderia trocar o `Prospector.exe`, a janela (`resources\app`) ou os scripts, que rodam com a conta do usuário.
   - O próprio Chromium da janela dá acesso a algumas pastas do perfil (`Cache`, `Network`, `Shared Dictionary`) para a SID de capacidade do serviço de rede isolado dele (`S-1-15-3-1024-…`). Não é outra conta do computador: é o sandbox do Chromium.
   - Perfil do Chromium (cache, cookies, armazenamento das páginas) em `<instalação>\dados-da-janela` (não em `%APPDATA%`, no C:), com o tamanho, a posição e o zoom da janela. O registro da janela fica em `logs\janela.log`.
9. **Atalhos e "Aplicativos instalados".** Área de Trabalho e Menu Iniciar abrem `programa\Prospector.exe`. Esses dois atalhos são gravados pelo próprio executável (`--criar-atalho`, só aceita caminhos absolutos terminados em `Prospector.lnk`) com o AppUserModelID `Prospector.Desktop`, o mesmo que a janela usa, para a barra de tarefas juntar a janela com o ícone fixado. "Parar Prospector" fecha a janela (e o servidor); "Desinstalar Prospector" remove a pasta, os atalhos e o registro em `HKCU\...\Uninstall\Prospector`, que põe o Prospector em Configurações > Aplicativos > Aplicativos instalados sem pedir administrador. O `iniciar.ps1` deixa de existir.
10. **Menu mínimo em pt-BR**, escondido (a tecla Alt mostra): Voltar, Avançar, Recarregar (Ctrl+R, F5), Sair; Editar; zoom, tela cheia e ferramentas de desenvolvedor; Ajuda com "Abrir a pasta de registros" e "Sobre o Prospector". Menu do botão direito com ortografia, links, imagem e edição.

## Consequências

- (+) O atalho abre uma janela própria com o ícone do Prospector, como os outros programas; fechar a janela fecha tudo.
- (+) A janela não depende do navegador do usuário nem guarda nada no C:.
- (+) Mesmo motor (Chromium) dos e2e; a janela tem testes unitários para endereços, telas, processos e o ciclo de vida do servidor (reaproveitar, porta de outro programa, queda, tempo esgotado, Node ausente), com um sistema falso no lugar do Windows.
- (−) Sem teste de ponta a ponta do executável nem do instalador: a montagem, a troca de pastas, a permissão da pasta, o "Parar Prospector" com a janela travada e a desinstalação completa só são conferidos à mão (KI-199).
- (−) ~400 MB em D: (mais ~150 MB do zip em `cache`) e dois Chromium no computador: o do Electron e o do Playwright da captura, que continua em `%LOCALAPPDATA%\ms-playwright` (KI-091). Não dá para a captura usar o Chromium do Electron.
- (−) O Electron precisa ser atualizado à mão (trocar a versão e reinstalar) para receber correções de segurança do Chromium (KI-201). A exposição é menor que a de um navegador: a janela só navega no app local e manda links de fora para o navegador, mas o Chromium dela ainda processa as imagens externas da prévia do e-mail.
- (−) O executável fica sem assinatura digital (editado localmente). Com o Smart App Control ligado, o Windows bloquearia o `Prospector.exe` (KI-200).
- (−) O servidor ainda depende do Node 24 do sistema.
- (−) Com a janela fechada, o servidor para, e com ele o trabalhador da fila (investigações e pesquisas em andamento, [ADR-0011](0011-fila-duravel-no-postgres.md)), os monitoramentos e o envio agendado de e-mails ([ADR-0016](0016-email-pela-caixa-fila-em-lote-e-mcp.md)). Antes, o servidor ficava no ar até o "Parar Prospector". A tarefa interrompida volta à fila pelo lease vencido quando o app abre de novo. Se for preciso trabalho com a janela fechada, a saída é um ícone na bandeja do sistema (decisão do usuário, não feita).

## Alternativas consideradas

- **Chrome ou Edge em modo app** (como estava): sem trabalho novo, mas é a janela do navegador do usuário; rejeitada pelo usuário.
- **Tauri 2**: ver a tabela; rejeitada pelo toolchain (Rust, MSVC) e por não tirar a dependência do Node.
- **Instalador empacotado (electron-builder, Squirrel, MSI)**: geraria `Setup.exe` e atualização automática, que não fazem sentido para um programa montado e usado neste computador; o `pnpm app:install` continua sendo a instalação.
- **Servidor no Node do Electron**: ver o item 5 da decisão.
