import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  extractFromHtml,
  forbidsAiUse,
  headerDirectives,
  looksLikeBotChallenge,
  normalizeText,
} from '../../src/web/html';

describe('extractFromHtml', () => {
  const page = `<!doctype html>
<html lang="pt-BR"><head>
<title>Cer&acirc;mica &amp; Cia &#8212; In&iacute;cio</title>
<meta name="description" content="Revestimentos &quot;premium&quot; desde 1990">
<meta name="ROBOTS" content="index, NoAI">
<style>.x{color:red}</style>
<script>window.segredo = "não deve aparecer"</script>
</head><body>
<!-- comentário escondido -->
<header><nav>Início | Produtos</nav></header>
<main><h1>Revestimentos</h1><p>Fabricamos   pisos
e&nbsp;azulejos.</p><ul><li>Linha A</li><li>Linha B</li></ul>
<svg><text>ícone</text></svg><noscript>ative o JS</noscript>
<template><p>modelo</p></template></main>
</body></html>`;

  it('tira título, descrição, idioma, diretivas e texto visível', () => {
    const extracted = extractFromHtml(page);
    expect(extracted.description).toBe('Revestimentos "premium" desde 1990');
    expect(extracted.lang).toBe('pt-BR');
    expect(extracted.robots).toEqual(['index', 'noai']);
    expect(extracted.text).toContain('Revestimentos');
    expect(extracted.text).toContain('Fabricamos pisos');
    expect(extracted.text).toContain('Linha A\n');
    for (const hidden of ['segredo', 'color:red', 'comentário', 'ícone', 'ative o JS', 'modelo']) {
      expect(extracted.text).not.toContain(hidden);
    }
  });

  it('decodifica entidades do português; desconhecida fica como está', () => {
    expect(extractFromHtml(page).title).toBe('Cerâmica & Cia — Início');
    expect(decodeEntities('A&Ccedil;&Atilde;O &eacute; &ccedil;&atilde;o')).toBe('AÇÃO é ção');
    expect(decodeEntities('&#x41;&#66;&lt;&bogus;&#0;')).toBe('AB<&bogus;&#0;');
  });

  it('página sem nada útil', () => {
    expect(extractFromHtml('<html><body><script>1</script></body></html>')).toEqual({
      title: null,
      description: null,
      lang: null,
      robots: [],
      text: '',
      links: [],
    });
  });
});

describe('normalizeText', () => {
  it('colapsa espaços e linhas vazias repetidas', () => {
    expect(normalizeText('  a \t b \r\n\r\n\r\n c  ')).toBe('a b\n\nc');
  });
});

describe('noai', () => {
  it('só noai conta como pedido de não uso por IA', () => {
    expect(forbidsAiUse(['noai'])).toBe(true);
    expect(forbidsAiUse(['noindex', 'nofollow', 'none', 'noimageai'])).toBe(false);
  });

  it('X-Robots-Tag: diretivas gerais e as do token prospector', () => {
    expect(headerDirectives('noindex, NoAI')).toEqual(['noindex', 'noai']);
    expect(headerDirectives('googlebot: noai, prospector: noai')).toEqual(['noai']);
    expect(headerDirectives('otherbot: noai')).toEqual([]);
    expect(headerDirectives(undefined)).toEqual([]);
  });
});

describe('HTML hostil (tempo linear)', () => {
  const MIB3 = 3 * 1024 * 1024;
  const inputs: Array<[string, string]> = [
    ['letras sem tags', 'a'.repeat(MIB3)],
    ['só "<"', '<'.repeat(MIB3)],
    ['comentários sem fechamento', '<!--'.repeat(MIB3 / 4)],
    ['scripts sem fechamento', '<script '.repeat(MIB3 / 8)],
    ['blocos sem ">"', '<p'.repeat(MIB3 / 2)],
    ['títulos sem fechamento', '<title>'.repeat(MIB3 / 7)],
    ['metas sem ">"', '<meta '.repeat(MIB3 / 6)],
    ['entidades sem ";"', `&${'a'.repeat(MIB3)}`],
  ];
  // Aqui cada caso leva menos de 0,1 s; no runner do CI, dividido com os outros testes, já
  // passou de 1 s. Um algoritmo quadrático em 3 MiB levaria minutos, então 5 s ainda o pega.
  it.each(inputs)('%s: termina em menos de 5 s', (_name, input) => {
    const started = performance.now();
    extractFromHtml(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('continua tirando comentários, scripts e o <head>', () => {
    const page = extractFromHtml(
      '<html><head><title>T</title></head><body><!-- x --><p>a</p><SCRIPT>b()</script ><style>c{}</style><p>d</p></body></html>',
    );
    expect(page.title).toBe('T');
    expect(page.text).toBe('a\n\nd');
  });

  it('<head> sem fechamento não apaga o corpo', () => {
    expect(extractFromHtml('<html><head><title>T</title><body><p>corpo</p>').text).toBe('corpo');
  });
});

describe('links da página', () => {
  it('tira href e texto, inclusive relativo, sem seguir comentários', () => {
    const extracted = extractFromHtml(
      `<nav><a href="/quem-somos">Quem <b>somos</b></a> <a class="x" href='https://outra.com/p?q=1#a'>Outra</a>
      <!-- <a href="/escondido">x</a> --><a>sem destino</a><a href="/sem-fim">aberto`,
    );
    expect(extracted.links).toEqual([
      { href: '/quem-somos', text: 'Quem somos' },
      { href: 'https://outra.com/p?q=1#a', text: 'Outra' },
      { href: '/sem-fim', text: '' },
    ]);
  });

  it('para em 300 links', () => {
    const html = Array.from({ length: 400 }, (_, i) => `<a href="/p${i}">p</a>`).join('');
    expect(extractFromHtml(html).links).toHaveLength(300);
  });
});

describe('looksLikeBotChallenge', () => {
  it.each([
    'Just a moment...',
    'Attention Required! | Cloudflare',
    'Client Challenge',
    'Access Denied',
    'Pardon Our Interruption',
    'Verificação de segurança',
    'DDoS-Guard',
  ])('título de tela anti-robô: %s', (title) => {
    expect(looksLikeBotChallenge({ title })).toBe(true);
  });

  it.each([
    'Security Check Ferramentas — Equipamentos de segurança',
    'Desafio Client Challenge: o evento',
    'Mozilla — Internet para pessoas',
    'Um momento especial para a sua festa | Buffet Alegria',
  ])('título normal não é desafio: %s', (title) => {
    expect(looksLikeBotChallenge({ title })).toBe(false);
  });

  it('frase típica só conta em página curta', () => {
    const tela =
      'Checking if the site connection is secure. Enable JavaScript and cookies to continue.';
    expect(looksLikeBotChallenge({ title: 'loja.example.com', text: tela })).toBe(true);
    const artigo = `${'Como funcionam os bloqueios de robôs. '.repeat(60)} ${tela}`;
    expect(looksLikeBotChallenge({ title: 'Blog', text: artigo })).toBe(false);
    expect(looksLikeBotChallenge({ title: null, text: null })).toBe(false);
  });
});
