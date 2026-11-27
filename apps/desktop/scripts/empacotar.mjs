/**
 * Monta o programa de desktop do Prospector na pasta de instalação (ADR-0018). Chamado por
 * `pnpm app:install` (scripts/app/instalar.mjs) depois de `pnpm --filter @prospector/desktop build`:
 *
 *   node apps/desktop/scripts/empacotar.mjs --destino D:\Prospector --icone D:\Prospector\prospector.ico --versao 2026.11.26
 *
 * 1. Baixa o Electron oficial (zip do GitHub) para `<destino>\cache`, uma vez por versão, e confere
 *    o SHA-256 com o `checksums.json` do pacote npm `electron` (fixado no pnpm-lock).
 * 2. Extrai em `<destino>\programa.novo` com o tar do Windows; tira o app de exemplo do Electron e
 *    os idiomas que o Prospector não usa.
 * 3. `electron.exe` vira `Prospector.exe`, com o ícone e o nome do Prospector (resedit), e com as
 *    travas do binário ligadas (@electron/fuses): não roda como Node, ignora NODE_OPTIONS e
 *    `--inspect`, cookies cifrados, sem privilégios extras para `file://`.
 * 4. Copia a janela (`apps/desktop/dist`) para `resources\app` e troca `programa` pela pasta nova.
 *    Com `--sem-trocar` (o que o instalador usa), para em `programa.novo`: o instalador fecha o
 *    Prospector só na hora da troca e faz a troca ele mesmo.
 *
 * Nada vai para o disco C: (KI-017): download, cache e programa ficam na pasta de instalação.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import * as ResEdit from 'resedit';

const require = createRequire(import.meta.url);
const pastaDoDesktop = fileURLToPath(new URL('..', import.meta.url));
/** Idiomas do Chromium que ficam (os outros somam dezenas de MB e não são usados). */
const IDIOMAS = new Set(['en-US.pak', 'pt-BR.pak', 'pt-PT.pak']);

function falhar(texto) {
  console.error(`\n✗ ${texto}`);
  process.exit(1);
}

function argumento(nome) {
  const indice = process.argv.indexOf(nome);
  const valor = indice >= 0 ? process.argv[indice + 1] : undefined;
  if (!valor) falhar(`Falta o argumento ${nome}.`);
  return valor;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

async function sha256(arquivo) {
  const hash = createHash('sha256');
  for await (const parte of createReadStream(arquivo)) hash.update(parte);
  return hash.digest('hex');
}

/** Sem receber nada por este tempo, o download é cancelado (rede parada não trava o instalador). */
const DOWNLOAD_PARADO_MS = 60_000;

async function baixar(url, arquivo, esperado) {
  const controle = new globalThis.AbortController();
  let vigia = setTimeout(() => controle.abort(), DOWNLOAD_PARADO_MS);
  const renovar = () => {
    clearTimeout(vigia);
    vigia = setTimeout(() => controle.abort(), DOWNLOAD_PARADO_MS);
  };
  try {
    await baixarCom(url, arquivo, esperado, controle.signal, renovar);
  } catch (erro) {
    rmSync(`${arquivo}.parcial`, { force: true });
    falhar(
      controle.signal.aborted
        ? `O download do Electron ficou ${DOWNLOAD_PARADO_MS / 1000} segundos sem receber nada e foi cancelado. Confira a internet e rode de novo.`
        : `Não foi possível baixar o Electron (${erro?.cause?.code ?? erro?.code ?? 'erro de rede'}). Confira a internet e rode de novo.`,
    );
  } finally {
    clearTimeout(vigia);
  }
}

async function baixarCom(url, arquivo, esperado, signal, renovar) {
  const resposta = await globalThis.fetch(url, { redirect: 'follow', signal });
  if (!resposta.ok || !resposta.body) falhar(`Download falhou (${resposta.status}): ${url}`);
  const total = Number(resposta.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let recebido = 0;
  let ultimo = -1;
  const parcial = `${arquivo}.parcial`;
  await pipeline(
    Readable.fromWeb(resposta.body),
    async function* (partes) {
      for await (const parte of partes) {
        renovar();
        hash.update(parte);
        recebido += parte.length;
        const decimo = total ? Math.floor((recebido / total) * 10) : 0;
        if (decimo !== ultimo) {
          ultimo = decimo;
          console.log(`  ${megabytes(recebido)}${total ? ` de ${megabytes(total)}` : ''}`);
        }
        yield parte;
      }
    },
    createWriteStream(parcial),
  );
  const obtido = hash.digest('hex');
  if (obtido !== esperado) {
    rmSync(parcial, { force: true });
    falhar(
      `SHA-256 do Electron não confere (esperado ${esperado}, veio ${obtido}). Nada foi instalado.`,
    );
  }
  renameSync(parcial, arquivo);
}

/** Ícone e textos do executável: o Gerenciador de Tarefas e a barra mostram "Prospector". */
function marcarExecutavel(exe, icone, versao) {
  const binario = ResEdit.NtExecutable.from(readFileSync(exe), { ignoreCert: true });
  const recursos = ResEdit.NtExecutableResource.from(binario);
  const grupos = ResEdit.Resource.IconGroupEntry.fromEntries(recursos.entries);
  if (grupos.length === 0) falhar('O Electron baixado não tem ícone para trocar.');
  const arquivoDeIcone = ResEdit.Data.IconFile.from(readFileSync(icone));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    recursos.entries,
    grupos[0].id,
    grupos[0].lang,
    arquivoDeIcone.icons.map((item) => item.data),
  );
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(recursos.entries);
  if (!info) falhar('O Electron baixado não tem informações de versão.');
  const [a, b, c] = versao.split('.').map((parte) => Number(parte) || 0);
  for (const idioma of info.getAllLanguagesForStringValues()) {
    info.setStringValues(idioma, {
      ProductName: 'Prospector',
      FileDescription: 'Prospector',
      CompanyName: 'Prospector (uso local)',
      InternalName: 'Prospector',
      OriginalFilename: 'Prospector.exe',
      LegalCopyright:
        'Janela feita com Electron (licença MIT); ver LICENSE e LICENSES.chromium.html.',
      FileVersion: versao,
      ProductVersion: versao,
    });
    info.setFileVersion(a, b, c, 0, idioma.lang);
    info.setProductVersion(a, b, c, 0, idioma.lang);
  }
  info.outputToResourceEntries(recursos.entries);
  recursos.outputResource(binario);
  writeFileSync(exe, Buffer.from(binario.generate()));
}

const destino = resolve(argumento('--destino'));
const icone = resolve(argumento('--icone'));
const versao = argumento('--versao');
if (!/^\d+\.\d+\.\d+$/.test(versao)) falhar(`Versão inválida: ${versao} (use a.b.c).`);
if (!existsSync(icone)) falhar(`Ícone não encontrado: ${icone}`);
const dist = join(pastaDoDesktop, 'dist');
if (!existsSync(join(dist, 'main.js')))
  falhar('Falta apps/desktop/dist/main.js: rode o build antes.');

const versaoDoElectron = require('electron/package.json').version;
const nomeDoZip = `electron-v${versaoDoElectron}-win32-x64.zip`;
const esperado = require('electron/checksums.json')[nomeDoZip];
if (!esperado) falhar(`O pacote electron não traz o SHA-256 de ${nomeDoZip}.`);

const cache = join(destino, 'cache');
mkdirSync(cache, { recursive: true });
const zip = join(cache, nomeDoZip);
if (existsSync(zip) && (await sha256(zip)) === esperado) {
  console.log(`  Electron ${versaoDoElectron} já baixado (${megabytes(statSync(zip).size)}).`);
} else {
  rmSync(zip, { force: true });
  const url = `https://github.com/electron/electron/releases/download/v${versaoDoElectron}/${nomeDoZip}`;
  console.log(`  Baixando o Electron ${versaoDoElectron} para ${cache}`);
  await baixar(url, zip, esperado);
}
// Versões antigas no cache não servem mais.
for (const nome of readdirSync(cache)) {
  if (nome !== nomeDoZip) rmSync(join(cache, nome), { recursive: true, force: true });
}

const novo = join(destino, 'programa.novo');
rmSync(novo, { recursive: true, force: true });
mkdirSync(novo, { recursive: true });
// O tar do Windows (bsdtar) abre zip; o do Git Bash não, por isso o caminho completo.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const extracao = spawnSync(tar, ['-xf', zip, '-C', novo], { stdio: 'inherit' });
if (extracao.status !== 0) falhar('Não foi possível extrair o Electron.');

rmSync(join(novo, 'resources', 'default_app.asar'), { force: true });
const idiomas = join(novo, 'locales');
for (const nome of readdirSync(idiomas)) {
  if (!IDIOMAS.has(nome)) rmSync(join(idiomas, nome), { force: true });
}

const exe = join(novo, 'Prospector.exe');
renameSync(join(novo, 'electron.exe'), exe);
marcarExecutavel(exe, icone, versao);
await flipFuses(exe, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
});

const aplicativo = join(novo, 'resources', 'app');
cpSync(dist, join(aplicativo, 'dist'), { recursive: true });
writeFileSync(
  join(aplicativo, 'package.json'),
  `${JSON.stringify(
    {
      name: 'prospector',
      productName: 'Prospector',
      version: versao,
      description: 'Prospector: janela do app instalado neste computador.',
      private: true,
      type: 'module',
      main: 'dist/main.js',
    },
    null,
    2,
  )}\n`,
);

if (process.argv.includes('--sem-trocar')) {
  console.log(
    `  Programa montado em ${novo} (Electron ${versaoDoElectron}); a troca fica com o instalador.`,
  );
  process.exit(0);
}

const programa = join(destino, 'programa');
try {
  rmSync(programa, { recursive: true, force: true });
} catch {
  falhar(`Não foi possível trocar ${programa}: feche o Prospector e rode de novo.`);
}
renameSync(novo, programa);
console.log(`  Programa montado em ${programa} (Electron ${versaoDoElectron}).`);
