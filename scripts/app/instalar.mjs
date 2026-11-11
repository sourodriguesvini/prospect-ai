/**
 * Instala o Prospector como aplicativo deste computador (`pnpm app:install`).
 *
 * 1. Para o app instalado, se estiver aberto (só o node dele).
 * 2. Gera o build autônomo do Next (`PROSPECTOR_STANDALONE=1`, ver apps/web/next.config.ts).
 * 3. Copia o servidor, os arquivos estáticos, os prompts versionados e o `apps/web/.env.local`
 *    para a pasta de instalação (padrão `D:\Prospector`, ou `PROSPECTOR_INSTALL_DIR`). O
 *    `.env.local` é copiado sem ser lido nem impresso.
 * 4. Copia os scripts de início, parada e desinstalação e cria os atalhos.
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
const scripts = join(raizRepo, 'scripts', 'app');
const destino = resolve(process.env.PROSPECTOR_INSTALL_DIR ?? 'D:\\Prospector');
const MARCA = '.prospector-instalacao';
/** Marca de ordem de bytes do UTF-8: o Windows PowerShell 5.1 e o Bloco de Notas leem acentos com ela. */
const BOM = String.fromCharCode(0xfeff);
const SCRIPTS_PS = ['iniciar.ps1', 'parar.ps1', 'desinstalar.ps1', 'criar-atalhos.ps1'];

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

/** Grava os scripts do PowerShell com BOM e CRLF: o Windows PowerShell 5.1 lê UTF-8 assim. */
function copiarScriptPowershell(nome) {
  const texto = readFileSync(join(scripts, nome), 'utf8').replace(/\r?\n/g, '\r\n');
  writeFileSync(join(destino, nome), `${BOM}${texto}`, 'utf8');
}

function versaoDoCodigo() {
  const git = (args) =>
    spawnSync('git', args, { cwd: raizRepo, encoding: 'utf8' }).stdout?.trim() ?? '';
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'desconhecido';
  const alterado = git(['status', '--porcelain']) ? ' (com alterações não commitadas)' : '';
  return `${commit}${alterado}`;
}

if (process.platform !== 'win32') falhar('A instalação como aplicativo é só para Windows.');

if (existsSync(destino) && !existsSync(join(destino, MARCA)) && readdirSync(destino).length > 0) {
  falhar(
    `${destino} já existe e não é uma instalação do Prospector. Escolha outra pasta com PROSPECTOR_INSTALL_DIR.`,
  );
}

etapa('Parando o Prospector instalado, se estiver aberto');
if (existsSync(join(destino, 'parar.ps1'))) powershell(join(destino, 'parar.ps1'), ['-Silencioso']);

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

etapa(`Copiando para ${destino}`);
mkdirSync(destino, { recursive: true });
writeFileSync(join(destino, MARCA), 'Pasta criada por `pnpm app:install` (Prospector).\r\n');
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
const atual = join(destino, 'app');
remover(atual);
renameSync(novo, atual);
console.log(`  Servidor copiado (${links} links de dependências preservados).`);

etapa('Copiando scripts e criando atalhos');
for (const nome of SCRIPTS_PS) copiarScriptPowershell(nome);
const leiaMe = readFileSync(join(scripts, 'LEIA-ME.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
writeFileSync(join(destino, 'LEIA-ME.txt'), `${BOM}${leiaMe}`, 'utf8');
writeFileSync(
  join(destino, 'versao.txt'),
  `${BOM}Código: ${versaoDoCodigo()}\r\nInstalado em: ${new Date().toISOString()}\r\nOrigem: ${raizRepo}\r\n`,
  'utf8',
);
powershell(join(destino, 'criar-atalhos.ps1'));

console.log(`\n✓ Prospector instalado em ${destino}.`);
console.log('  Abra pelo atalho "Prospector" na Área de Trabalho ou no Menu Iniciar.');
console.log('  O app roda em http://127.0.0.1:3210 (só este computador).');
