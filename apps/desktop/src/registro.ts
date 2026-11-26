/**
 * Registro da janela em `logs\janela.log` (abertura do servidor, erros). Sem dados do usuário:
 * só eventos da janela e do servidor.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const TAMANHO_MAXIMO = 1024 * 1024;

export type Registrar = (mensagem: string) => void;

export function criarRegistro(arquivo: string, agora: () => Date = () => new Date()): Registrar {
  try {
    mkdirSync(dirname(arquivo), { recursive: true });
    const tamanho = statSync(arquivo, { throwIfNoEntry: false })?.size ?? 0;
    if (tamanho > TAMANHO_MAXIMO) {
      const antigo = `${arquivo}.1`;
      rmSync(antigo, { force: true });
      renameSync(arquivo, antigo);
    }
  } catch {
    // Registro é ajuda para diagnóstico; a janela funciona sem ele.
  }
  return (mensagem) => {
    try {
      appendFileSync(arquivo, `${agora().toISOString()} ${mensagem}\r\n`, 'utf8');
    } catch {
      // idem
    }
  };
}
