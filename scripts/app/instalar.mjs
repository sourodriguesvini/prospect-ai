/**
 * Instala o Prospector como programa deste computador (`pnpm app:install`, ADR-0018).
 *
 * 1. Prepara a pasta de instalação (padrão `D:\Prospector`, ou `PROSPECTOR_INSTALL_DIR`): só a sua
 *    conta, o sistema e os administradores têm acesso (ela guarda a chave do banco e programas que
 *    rodam com a sua conta), e grava os scripts de parada, desinstalação, atalhos e ícone. Prepara
 *    também a pasta de dados ao lado (`D:\Prospector-dados\capturas`), com o mesmo acesso, que
 *    nenhuma atualização ou desinstalação apaga, e o registro dela para o `pnpm dev`.
 * 2. Gera o build autônomo do Next (`PROSPECTOR_STANDALONE=1`, ver apps/web/next.config.ts).
 * 3. Monta a janela nova (`programa.novo`, Electron) com apps/desktop: o Electron é baixado uma vez
 *    por versão para `<pasta>\cache` e conferido pelo SHA-256.
 * 4. Copia o servidor, os arquivos estáticos, os prompts versionados e o `apps/web/.env.local` para
 *    `app.novo`. O `.env.local` é copiado sem ser lido nem impresso.
 * 5. Só então fecha o Prospector instalado, se estiver aberto (a janela e o servidor dele; nada de
 *    outro programa), e troca `programa` e `app` pelas pastas novas, por renomeação: se algo
 *    estiver em uso, a troca falha inteira e a versão anterior continua no lugar.
 * 6. Cria os atalhos e o registro em "Aplicativos instalados".
 *
 * O app instalado roda só em 127.0.0.1 (ADR-0007) e usa o mesmo banco do `.env.local`.
 * Rode de novo depois de cada mudança no código para atualizar a instalação.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizRepo = fileURLToPath(new URL('../..', import.meta.url));
const web = join(raizRepo, 'apps', 'web');
const desktop = join(raizRepo, 'apps', 'desktop');
const scripts = join(raizRepo, 'scripts', 'app');
const destino = resolve(process.env.PROSPECTOR_INSTALL_DIR ?? 'D:\\Prospector');
const MARCA = '.prospector-instalacao';
const MARCA_DOS_DADOS = '.prospector-dados';
/** Marca de ordem de bytes do UTF-8: o Windows PowerShell 5.1 e o Bloco de Notas leem acentos com ela. */
const BOM = String.fromCharCode(0xfeff);
const SCRIPTS_PS = ['parar.ps1', 'desinstalar.ps1', 'criar-atalhos.ps1', 'criar-icone.ps1'];
/** Arquivos de instalações antigas que não existem mais (o atalho abria o Chrome em modo app). */
const OBSOLETOS = ['iniciar.ps1'];

function etapa(texto) {
  console.log(`\n» ${texto}`);
}

function falhar(texto) {
  console.error(`\n✗ ${texto}`);
  process.exit(1);
}

function rodar(comando, args, opcoes = {}) {
  const resultado = spawnSync(comando, args, { stdio: 'inherit', ...opcoes });
  if (resultado.status !== 0) falhar(`Falhou: ${comando} ${args.join(' ')}`);
}

function powershell(arquivo, args = []) {
  rodar('powershell.exe', ['-NoProfile', '-File', arquivo, ...args]);
}

/**
 * Copia uma pasta mantendo os links simbólicos do pnpm como links relativos. Os links são
 * criados no fim, quando os alvos já existem: no Windows, o tipo (pasta ou arquivo) depende disso.
 */
function copiarComLinks(origem, alvo) {
  const links = [];
  cpSync(origem, alvo, {
    recursive: true,
    filter: (caminho) => {
      if (!lstatSync(caminho).isSymbolicLink()) return true;
      links.push(caminho);
      return false;
    },
  });
  for (const link of links) {
    const apontaPara = readlinkSync(link);
    if (isAbsolute(apontaPara)) {
      falhar(
        `Link com caminho absoluto no build (${link}); a instalação dependeria do repositório.`,
      );
    }
    const novoLink = join(alvo, relative(origem, link));
    mkdirSync(dirname(novoLink), { recursive: true });
    try {
      symlinkSync(apontaPara, novoLink, statSync(link).isDirectory() ? 'dir' : 'file');
    } catch (erro) {
      if (erro.code !== 'EPERM') throw erro;
      falhar(
        'O Windows não deixou criar links simbólicos. Ative o Modo de Desenvolvedor ' +
          '(Configurações > Sistema > Para desenvolvedores) ou rode o terminal como administrador.',
      );
    }
  }
  return links.length;
}

function remover(pasta) {
  if (existsSync(pasta)) rmSync(pasta, { recursive: true, force: true });
}

const SISTEMA = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const POWERSHELL = join(SISTEMA, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** SYSTEM e Administradores (SIDs fixos: os nomes dos grupos mudam com o idioma do Windows). */
const SIDS_DO_SISTEMA = ['S-1-5-18', 'S-1-5-32-544'];

/**
 * Deixa a pasta acessível só à sua conta, ao sistema e aos administradores, como o
 * `%LOCALAPPDATA%`. Sem isto ela herda do `D:\` a permissão de "Usuários autenticados" alterarem
 * arquivos: outra conta deste computador leria a chave do banco (`.env.local`) e poderia trocar o
 * `Prospector.exe` ou os scripts que rodam com a sua conta. Confere o resultado depois.
 */
function restringirPasta(pasta) {
  const sid = spawnSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ],
    { encoding: 'utf8' },
  ).stdout?.trim();
  if (!sid || !/^S-1-5-21(-\d+)+$/.test(sid)) {
    falhar('Não foi possível identificar a sua conta do Windows para proteger a pasta.');
  }
  rodar(join(SISTEMA, 'icacls.exe'), [
    pasta,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(OI)(CI)F`,
    ...SIDS_DO_SISTEMA.map((item) => `*${item}:(OI)(CI)F`),
    '/Q',
  ]);
  // O caminho vai por variável de ambiente: nada de montar comando com ele.
  const conferencia = spawnSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-Acl -LiteralPath $env:PROSPECTOR_PASTA).Access | ForEach-Object { try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $_.IdentityReference.Value } }',
    ],
    { encoding: 'utf8', env: { ...process.env, PROSPECTOR_PASTA: pasta } },
  );
  const sids = new Set(
    (conferencia.stdout ?? '')
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter(Boolean),
  );
  const permitidos = new Set([sid, ...SIDS_DO_SISTEMA]);
  const sobrando = [...sids].filter((item) => !permitidos.has(item));
  if (conferencia.status !== 0 || !sids.has(sid) || sobrando.length > 0) {
    falhar(
      `A pasta ${pasta} não ficou restrita à sua conta (sobrou: ${sobrando.join(', ') || 'nada'}). Nada foi copiado para ela.`,
    );
  }
  console.log('  Acesso à pasta: só a sua conta, o sistema e os administradores.');
}

/** `base`, ou `base-<data>` se a sobra de uma troca anterior ainda estiver presa. */
function nomeLivre(base) {
  try {
    remover(base);
    return base;
  } catch {
    return `${base}-${Date.now()}`;
  }
}

/**
 * Troca cada pasta atual pela nova sem deixar a instalação pela metade: renomeia as atuais (no
 * Windows, a renomeação de uma pasta falha se algum arquivo dela estiver em uso), põe as novas no
 * lugar e só então apaga as antigas. Se qualquer passo falhar, desfaz o que já fez e a versão
 * anterior continua inteira.
 */
function trocarPastas(pares) {
  const feitas = [];
  const desfazer = () => {
    for (const item of [...feitas].reverse()) {
      try {
        if (item.entrou) renameSync(item.atual, item.nova);
        if (item.velha && existsSync(item.velha)) renameSync(item.velha, item.atual);
      } catch {
        console.warn(
          `  Aviso: não deu para restaurar ${item.atual}; a versão anterior está em ${item.velha}.`,
        );
      }
    }
  };
  for (const [nova, atual] of pares) {
    const item = { nova, atual, velha: null, entrou: false };
    if (existsSync(atual)) {
      const velha = nomeLivre(`${atual}.velho`);
      try {
        renameSync(atual, velha);
      } catch {
        desfazer();
        falhar(
          `Não foi possível trocar ${atual}: algum arquivo dela está em uso. Feche o Prospector (ou use "Parar Prospector") e rode de novo; a versão anterior continua no lugar.`,
        );
      }
      item.velha = velha;
    }
    feitas.push(item);
  }
  for (const item of feitas) {
    try {
      renameSync(item.nova, item.atual);
      item.entrou = true;
    } catch (erro) {
      desfazer();
      falhar(
        `Não foi possível pôr a versão nova em ${item.atual} (${erro.code ?? 'erro'}); a versão anterior continua no lugar.`,
      );
    }
  }
  for (const item of feitas) {
    if (!item.velha) continue;
    try {
      remover(item.velha);
    } catch {
      console.warn(`  Aviso: não deu para apagar ${item.velha}; ela pode ser apagada depois.`);
    }
  }
}

/** Grava os scripts do PowerShell com BOM e CRLF: o Windows PowerShell 5.1 lê UTF-8 assim. */
function copiarScriptPowershell(nome) {
  const texto = readFileSync(join(scripts, nome), 'utf8').replace(/\r?\n/g, '\r\n');
  writeFileSync(join(destino, nome), `${BOM}${texto}`, 'utf8');
}

/** Versão do programa no Windows: a data da instalação (ano.mês.dia). */
function versaoDoPrograma(agora = new Date()) {
  return `${agora.getFullYear()}.${agora.getMonth() + 1}.${agora.getDate()}`;
}

function versaoDoCodigo() {
  const git = (args) =>
    spawnSync('git', args, { cwd: raizRepo, encoding: 'utf8' }).stdout?.trim() ?? '';
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'desconhecido';
  const alterado = git(['status', '--porcelain']) ? ' (com alterações não commitadas)' : '';
  return `${commit}${alterado}`;
}

/**
 * Pasta de dados do usuário ao lado da instalação (`D:\Prospector-dados`, mesma regra de
 * apps/desktop/src/config.ts `pastaDeDados`): hoje guarda as capturas de marca. Atualizar ou
 * desinstalar o programa nunca a apaga (diretriz de 2026-11-26, Parte 13.2). Mesmo acesso restrito
 * da instalação. Também grava `%LOCALAPPDATA%\Prospector\instalacao.json`, com o qual o `pnpm dev`
 * acha a mesma pasta (os dois leem o mesmo banco).
 */
function prepararPastaDeDados() {
  const dados = `${destino.replace(/[\\/]+$/, '')}-dados`;
  if (
    existsSync(dados) &&
    !existsSync(join(dados, MARCA_DOS_DADOS)) &&
    readdirSync(dados).length > 0
  ) {
    falhar(
      `${dados} já existe e não é a pasta de dados do Prospector. Escolha outra pasta de instalação com PROSPECTOR_INSTALL_DIR.`,
    );
  }
  mkdirSync(dados, { recursive: true });
  restringirPasta(dados);
  // Depois da restrição: a subpasta herda o acesso da pasta de dados.
  mkdirSync(join(dados, 'capturas'), { recursive: true });
  writeFileSync(
    join(dados, MARCA_DOS_DADOS),
    'Dados do Prospector (capturas de marca). Atualizar ou desinstalar o programa não apaga esta pasta.\r\n',
  );
  const local = process.env.LOCALAPPDATA;
  if (local && isAbsolute(local)) {
    const pastaDoRegistro = join(local, 'Prospector');
    mkdirSync(pastaDoRegistro, { recursive: true });
    writeFileSync(
      join(pastaDoRegistro, 'instalacao.json'),
      `${JSON.stringify({ raiz: destino, dados, atualizadoEm: new Date().toISOString() }, null, 2)}\n`,
    );
  } else {
    console.warn('  Aviso: sem %LOCALAPPDATA%; o pnpm dev não vai achar a pasta de dados sozinho.');
  }
  console.log(`  Dados do usuário (capturas): ${join(dados, 'capturas')}`);
}

if (process.platform !== 'win32') falhar('A instalação como aplicativo é só para Windows.');

if (existsSync(destino) && !existsSync(join(destino, MARCA)) && readdirSync(destino).length > 0) {
  falhar(
    `${destino} já existe e não é uma instalação do Prospector. Escolha outra pasta com PROSPECTOR_INSTALL_DIR.`,
  );
}

// O Prospector instalado continua aberto até a troca das pastas: o build e a montagem levam minutos
// e, se falharem, nada do que está em uso foi mexido.
etapa(`Preparando ${destino}`);
mkdirSync(destino, { recursive: true });
restringirPasta(destino);
writeFileSync(join(destino, MARCA), 'Pasta criada por `pnpm app:install` (Prospector).\r\n');
for (const nome of SCRIPTS_PS) copiarScriptPowershell(nome);
prepararPastaDeDados();

etapa('Gerando o build autônomo (next build)');
const standalone = join(web, '.next', 'standalone');
remover(standalone);
// Comando inteiro numa string: o pnpm do Windows é um .cmd e precisa do shell.
rodar('pnpm exec next build', [], {
  cwd: web,
  shell: true,
  env: { ...process.env, PROSPECTOR_STANDALONE: '1', NEXT_TELEMETRY_DISABLED: '1' },
});
if (!existsSync(join(standalone, 'apps', 'web', 'server.js'))) {
  falhar('O build não gerou .next/standalone/apps/web/server.js.');
}

etapa('Montando a janela do programa (Electron)');
const versao = versaoDoPrograma();
rodar('pnpm --filter @prospector/desktop build', [], { cwd: raizRepo, shell: true });
// Ícone novo ao lado do atual: o atual pode estar em uso pelos atalhos e pela janela aberta.
const icone = join(destino, 'prospector.ico');
const iconeNovo = join(destino, 'prospector.novo.ico');
powershell(join(destino, 'criar-icone.ps1'), ['-Arquivo', iconeNovo]);
rodar(process.execPath, [
  join(desktop, 'scripts', 'empacotar.mjs'),
  '--destino',
  destino,
  '--icone',
  iconeNovo,
  '--versao',
  versao,
  '--sem-trocar',
]);

etapa('Copiando o servidor');
const novo = join(destino, 'app.novo');
remover(novo);
const links = copiarComLinks(standalone, novo);
cpSync(join(web, '.next', 'static'), join(novo, 'apps', 'web', '.next', 'static'), {
  recursive: true,
});
if (existsSync(join(web, 'public'))) {
  cpSync(join(web, 'public'), join(novo, 'apps', 'web', 'public'), { recursive: true });
}
// Os prompts versionados são lidos do disco em tempo de execução (packages/agents/src/prompts.ts,
// KI-035): `findPromptsDir` sobe a partir de apps/web até achar o pnpm-workspace.yaml e
// packages/agents/prompts. Sem isto o Copiloto do app instalado não acha o prompt.
cpSync(
  join(raizRepo, 'packages', 'agents', 'prompts'),
  join(novo, 'packages', 'agents', 'prompts'),
  {
    recursive: true,
  },
);
cpSync(join(raizRepo, 'pnpm-workspace.yaml'), join(novo, 'pnpm-workspace.yaml'));
const env = join(web, '.env.local');
if (existsSync(env)) {
  cpSync(env, join(novo, 'apps', 'web', '.env.local'));
} else {
  console.warn('  Aviso: sem apps/web/.env.local; o app instalado abre sem banco configurado.');
}
console.log(`  Servidor copiado (${links} links de dependências preservados).`);

etapa('Fechando o Prospector instalado, se estiver aberto, e trocando pela versão nova');
powershell(join(destino, 'parar.ps1'), ['-Silencioso']);
trocarPastas([
  [join(destino, 'programa.novo'), join(destino, 'programa')],
  [novo, join(destino, 'app')],
]);
try {
  renameSync(iconeNovo, icone);
} catch {
  console.warn(`  Aviso: o ícone atual está em uso; o novo ficou em ${iconeNovo}.`);
}
console.log('  Versão nova no lugar.');

etapa('Criando atalhos');
const leiaMe = readFileSync(join(scripts, 'LEIA-ME.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
writeFileSync(join(destino, 'LEIA-ME.txt'), `${BOM}${leiaMe}`, 'utf8');
writeFileSync(
  join(destino, 'versao.txt'),
  `${BOM}Código: ${versaoDoCodigo()}\r\nInstalado em: ${new Date().toISOString()}\r\nOrigem: ${raizRepo}\r\n`,
  'utf8',
);
powershell(join(destino, 'criar-atalhos.ps1'), ['-Versao', versao]);
// Só depois dos atalhos novos: se algo falhar antes, os atalhos antigos ainda acham o que usam.
for (const nome of OBSOLETOS) rmSync(join(destino, nome), { force: true });

console.log(`\n✓ Prospector instalado em ${destino}.`);
console.log('  Abra pelo atalho "Prospector" na Área de Trabalho ou no Menu Iniciar.');
console.log(
  `  A janela é ${join(destino, 'programa', 'Prospector.exe')}; o app roda em http://127.0.0.1:3210 (só este computador).`,
);
