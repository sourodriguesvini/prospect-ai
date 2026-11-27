/**
 * Consultas e ações sobre processos do Windows usadas pela janela (ADR-0018). Regra: a janela só
 * encerra o servidor do próprio Prospector, conferido pelo nome (`node.exe`) e pela linha de
 * comando (o `server.js` da instalação). Nunca mexe em processo de outro programa.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { win32 } from 'node:path';

// O programa só roda no Windows; `win32` deixa os caminhos iguais nos testes do CI (Linux).
const { delimiter, join } = win32;

export interface Processo {
  pid: number;
  /** Nome do executável, por exemplo `node.exe`. */
  nome: string;
  /** Linha de comando completa; vazia se o Windows não deixar ler (processo de administrador). */
  linha: string;
}

/** Pasta do sistema (`C:\Windows\System32`), para não pegar `tar`, `taskkill` etc. de outro PATH. */
export function pastaDoSistema(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32');
}

/** Alguém aceita conexão nesta porta de 127.0.0.1? */
export function portaEmUso(porta: number, esperaMs = 800): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = connect({ host: '127.0.0.1', port: porta });
    const terminar = (emUso: boolean) => {
      socket.destroy();
      resolver(emUso);
    };
    socket.setTimeout(esperaMs, () => terminar(false));
    socket.once('connect', () => terminar(true));
    socket.once('error', () => terminar(false));
  });
}

/**
 * O que vem depois do executável na linha de comando do Windows (`"C:\...
ode.exe" a b` → `a b`).
 * Vazio se não houver nada depois.
 */
export function argumentosDaLinha(linha: string): string {
  const texto = linha.trim();
  if (texto.startsWith('"')) {
    const fim = texto.indexOf('"', 1);
    return fim === -1 ? '' : texto.slice(fim + 1).trim();
  }
  const espaco = texto.search(/\s/);
  return espaco === -1 ? '' : texto.slice(espaco + 1).trim();
}

/**
 * O processo é o servidor deste Prospector? Exige o `node.exe` com UM argumento só: o `server.js`
 * desta instalação (entre aspas ou não). `node outro.js ...\server.js` não passa.
 */
export function ehServidorDoProspector(processo: Processo | null, servidorJs: string): boolean {
  if (!processo || processo.nome.toLowerCase() !== 'node.exe' || !processo.linha) return false;
  const argumentos = argumentosDaLinha(processo.linha).toLowerCase();
  const alvo = servidorJs.toLowerCase();
  return argumentos === alvo || argumentos === `"${alvo}"`;
}

/** Lê a saída JSON do PowerShell e confere o formato antes de usar. */
export function lerProcesso(saida: string): Processo | null {
  const texto = saida.trim();
  if (!texto) return null;
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== 'object' || valor === null) return null;
  const { pid, nome, linha } = valor as Record<string, unknown>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  return {
    pid,
    nome: typeof nome === 'string' ? nome : '',
    linha: typeof linha === 'string' ? linha : '',
  };
}

function rodarPowershell(script: string, esperaMs = 15_000): Promise<string> {
  const codificado = Buffer.from(
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`,
    'utf16le',
  ).toString('base64');
  const powershell = join(pastaDoSistema(), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolver) => {
    const filho = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        codificado,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let saida = '';
    const limite = setTimeout(() => filho.kill(), esperaMs);
    filho.stdout.setEncoding('utf8');
    filho.stdout.on('data', (parte: string) => (saida += parte));
    filho.once('error', () => {
      clearTimeout(limite);
      resolver('');
    });
    filho.once('close', () => {
      clearTimeout(limite);
      resolver(saida);
    });
  });
}

const SAIDA_DO_PROCESSO = `if (-not $p) { return }
[pscustomobject]@{ pid = [int]$p.ProcessId; nome = [string]$p.Name; linha = [string]$p.CommandLine } | ConvertTo-Json -Compress`;

/** Processo que está ouvindo na porta (em qualquer endereço), ou `null`. */
export async function donoDaPorta(porta: number): Promise<Processo | null> {
  const script = `$c = Get-NetTCPConnection -LocalPort ${Math.trunc(porta)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) { return }
$p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)" -ErrorAction SilentlyContinue
${SAIDA_DO_PROCESSO}`;
  return lerProcesso(await rodarPowershell(script));
}

export async function processoPorPid(pid: number): Promise<Processo | null> {
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Math.trunc(pid)}" -ErrorAction SilentlyContinue
${SAIDA_DO_PROCESSO}`;
  return lerProcesso(await rodarPowershell(script));
}

/** O processo ainda existe? (sinal 0 só testa, não encerra.) */
export function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Encerra o processo. Só chame com um PID conferido por `ehServidorDoProspector` ou aberto pela
 * própria janela. Sem `/T`: o Windows guarda o PID do pai mesmo depois que ele morre, e o `/T`
 * poderia derrubar um programa alheio que tenha "herdado" um PID reaproveitado (o Ollama, por
 * exemplo). O que o servidor abriu sem `detached` (o Chromium da captura) está no job do libuv e
 * cai junto com ele.
 */
export function encerrarProcesso(pid: number): boolean {
  const resultado = spawnSync(
    join(pastaDoSistema(), 'taskkill.exe'),
    ['/PID', String(Math.trunc(pid)), '/F'],
    { windowsHide: true, timeout: 15_000, stdio: 'ignore' },
  );
  return resultado.status === 0;
}

/** `node.exe` do PATH (o Node 24 do sistema roda o servidor, como no `pnpm dev`). */
export function encontrarNode(
  env: NodeJS.ProcessEnv = process.env,
  existe: (caminho: string) => boolean = existsSync,
): string | null {
  const pastas = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const programas = env.ProgramFiles ?? env.PROGRAMFILES;
  if (programas) pastas.push(join(programas, 'nodejs'));
  for (const pasta of pastas) {
    const candidato = join(pasta.replace(/^"|"$/g, ''), 'node.exe');
    if (existe(candidato)) return candidato;
  }
  return null;
}

/** Versão principal do Node (24 em `v24.21.0`), ou `null` se não der para ler. */
export function versaoPrincipal(texto: string): number | null {
  const achado = /^v?(\d+)\./.exec(texto.trim());
  return achado ? Number(achado[1]) : null;
}

export function versaoDoNode(node: string): number | null {
  const resultado = spawnSync(node, ['--version'], {
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf8',
  });
  return resultado.status === 0 ? versaoPrincipal(resultado.stdout) : null;
}
