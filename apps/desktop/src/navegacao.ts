/**
 * Para onde a janela pode ir (ADR-0018). A janela só mostra o app em `http://127.0.0.1:3210`;
 * links da web abrem no navegador do sistema; o resto é recusado.
 */
import { ORIGEM_DO_APP } from './config.js';

export type Destino = 'app' | 'externo' | 'recusado';

/** Esquemas que podem ir para o navegador ou o programa de e-mail do sistema. */
const ESQUEMAS_EXTERNOS = new Set(['http:', 'https:', 'mailto:']);

export function classificarEndereco(endereco: string): Destino {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return 'recusado';
  }
  if (url.origin === ORIGEM_DO_APP) return 'app';
  if (!ESQUEMAS_EXTERNOS.has(url.protocol)) return 'recusado';
  if (url.protocol === 'mailto:') return 'externo';
  // http(s) sem servidor ou com usuário e senha no endereço não sai.
  if (!url.hostname || url.username || url.password) return 'recusado';
  return 'externo';
}

/** Quadros internos (prévia do e-mail) podem ficar em branco ou no próprio app. */
export function quadroPodeIr(endereco: string): boolean {
  return (
    endereco === 'about:blank' ||
    endereco === 'about:srcdoc' ||
    classificarEndereco(endereco) === 'app'
  );
}
