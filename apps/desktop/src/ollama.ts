/**
 * Abre o programa do Ollama se ele estiver fechado, como o antigo `iniciar.ps1` fazia (ADR-0018).
 * A janela só testa se a porta do Ollama aceita conexão; quem fala com a API é o gateway em
 * packages/agents (ADR-0008), dentro do servidor.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { portaEmUso } from './processos.js';

const PORTA_DO_OLLAMA = 11434;

export function candidatosDoOllama(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidatos = ['D:\\ollama\\app\\ollama app.exe'];
  const local = env.LOCALAPPDATA;
  if (local) candidatos.push(join(local, 'Programs', 'Ollama', 'ollama app.exe'));
  return candidatos;
}

/**
 * Devolve o que fez, para o registro da janela. O Ollama abre separado (`detached`): continua
 * aberto quando o Prospector fecha, como qualquer programa que o usuário abriu.
 */
export async function abrirOllamaSeFechado(
  existe: (caminho: string) => boolean = existsSync,
): Promise<string> {
  if (await portaEmUso(PORTA_DO_OLLAMA)) return 'Ollama já estava aberto.';
  const programa = candidatosDoOllama().find((caminho) => existe(caminho));
  if (!programa) return 'Ollama fechado e não encontrado; o Copiloto avisa na tela.';
  const filho = spawn(programa, [], { detached: true, stdio: 'ignore', windowsHide: true });
  filho.once('error', () => undefined);
  filho.unref();
  return `Ollama aberto (${programa}).`;
}
