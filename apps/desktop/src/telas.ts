/**
 * Telas da própria janela enquanto o servidor sobe ou quando algo falha (ADR-0018). São páginas
 * `data:` sem script (a política da página não deixa rodar nenhum), com as cores do design system
 * (packages/ui/src/styles/tokens.css) e o tema claro ou escuro do Windows.
 */
import { URL_DO_APP } from './config.js';

export interface ErroDaJanela {
  titulo: string;
  mensagem: string;
  /** Texto menor embaixo (onde ver os registros, por exemplo). */
  detalhe?: string;
  /** Mostra o botão "Tentar de novo" (padrão: sim). */
  podeTentarDeNovo?: boolean;
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Quebras de linha da mensagem viram `<br>` depois de escapar o texto. */
function paragrafo(texto: string): string {
  return escaparHtml(texto).replace(/\r?\n/g, '<br>');
}

const MARCA = `<svg class="marca" viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="16" fill="#141416"/>
  <text x="29" y="46" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-weight="700" font-size="42" fill="#fff">P</text>
  <circle cx="49.5" cy="49.5" r="5.75" fill="#c2410c"/>
</svg>`;

const ESTILO = `
:root { color-scheme: light dark; --fundo: #f3f3f4; --texto: #141416; --suave: #6b6b72;
  --borda: #e4e4e7; --acento: #c2410c; --acento-texto: #ffffff; }
@media (prefers-color-scheme: dark) {
  :root { --fundo: #111113; --texto: #f4f4f5; --suave: #a1a1aa; --borda: #27272a; }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; padding: 24px; background: var(--fundo);
  color: var(--texto); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; user-select: none; }
main { max-width: 32rem; text-align: center; display: grid; justify-items: center; gap: 12px; }
.marca { width: 64px; height: 64px; margin-bottom: 8px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
p { margin: 0; color: var(--suave); }
.detalhe { font-size: 13px; }
.roda { width: 28px; height: 28px; margin-top: 8px; border-radius: 50%;
  border: 3px solid var(--borda); border-top-color: var(--acento); animation: gira .9s linear infinite; }
@keyframes gira { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .roda { animation-duration: 3s; } }
a.botao { margin-top: 8px; display: inline-block; padding: 8px 18px; border-radius: 999px;
  background: var(--acento); color: var(--acento-texto); text-decoration: none; font-weight: 600; }
a.botao:focus-visible { outline: 2px solid var(--texto); outline-offset: 3px; }
`;

function documento(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escaparHtml(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body><main>${MARCA}${corpo}</main></body>
</html>`;
}

/** Página `data:` pronta para `loadURL`. */
export function comoEnderecoDeDados(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function telaDeCarregamento(): string {
  return comoEnderecoDeDados(
    documento(
      'Prospector',
      `<h1>Abrindo o Prospector</h1>
<p>Subindo o servidor deste computador. Na primeira vez do dia leva alguns segundos.</p>
<div class="roda" role="status" aria-label="Carregando"></div>`,
    ),
  );
}

/**
 * Tela de erro. "Tentar de novo" é um link para o próprio app: a janela intercepta o clique e
 * refaz a abertura (sobe o servidor de novo, se for preciso).
 */
export function telaDeErro(erro: ErroDaJanela): string {
  const botao =
    erro.podeTentarDeNovo === false
      ? ''
      : `<a class="botao" href="${URL_DO_APP}">Tentar de novo</a>`;
  const detalhe = erro.detalhe ? `<p class="detalhe">${paragrafo(erro.detalhe)}</p>` : '';
  return comoEnderecoDeDados(
    documento(
      'Prospector',
      `<h1>${escaparHtml(erro.titulo)}</h1>
<p role="alert">${paragrafo(erro.mensagem)}</p>
${detalhe}
${botao}`,
    ),
  );
}
