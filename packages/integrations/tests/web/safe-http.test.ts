import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_AGENT } from '../../src/http';
import { nodeTransport, safeFetch } from '../../src/web/safe-http';
import { PUBLIC_IP, fakeResolver, fakeTransport, html, redirect, reply } from './net-fakes';

const resolver = fakeResolver({
  'empresa.example.com': [PUBLIC_IP],
  'outra.example.org': ['151.101.1.1'],
  'rebind.example.com': ['127.0.0.1'],
  'misto.example.com': [PUBLIC_IP, '192.168.0.10'],
});

const base = { resolver, maxBytes: 1024, timeoutMs: 2000 };

describe('safeFetch', () => {
  it('conecta no endereço conferido, com User-Agent genérico e sem cookies', async () => {
    const net = fakeTransport({ 'https://empresa.example.com/': html('<p>oi</p>') });
    const result = await safeFetch('https://empresa.example.com/#secao', {
      ...base,
      transport: net.transport,
    });
    expect(result.ok).toBe(true);
    const [call] = net.calls;
    expect(call?.address).toBe(PUBLIC_IP);
    expect(call?.family).toBe(4);
    expect(call?.url.hash).toBe('');
    expect(call?.headers['user-agent']).toBe(USER_AGENT);
    expect(Object.keys(call?.headers ?? {})).not.toContain('cookie');
  });

  it('recusa redirecionamento para metadados de nuvem sem fazer o segundo pedido', async () => {
    const net = fakeTransport({
      'https://empresa.example.com/': redirect('http://169.254.169.254/latest/meta-data/'),
    });
    const result = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: net.transport,
    });
    expect(result).toEqual({ ok: false, failure: 'blocked_address' });
    expect(net.calls).toHaveLength(1);
  });

  it('recusa redirecionamento para nome cujo DNS aponta para dentro (rebinding)', async () => {
    const net = fakeTransport({
      'https://empresa.example.com/': redirect('https://rebind.example.com/'),
    });
    const result = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: net.transport,
    });
    expect(result).toEqual({ ok: false, failure: 'blocked_address' });
    expect(net.urls()).toEqual(['https://empresa.example.com/']);
  });

  it('recusa nome com respostas públicas e privadas misturadas', async () => {
    const net = fakeTransport({});
    const result = await safeFetch('https://misto.example.com/', {
      ...base,
      transport: net.transport,
    });
    expect(result).toEqual({ ok: false, failure: 'blocked_address' });
    expect(net.calls).toHaveLength(0);
  });

  it('recusa redirecionamento para porta, esquema ou host interno', async () => {
    for (const location of [
      'http://empresa.example.com:8080/',
      'file:///etc/passwd',
      'http://localhost/',
    ]) {
      const net = fakeTransport({ 'https://empresa.example.com/': redirect(location) });
      const result = await safeFetch('https://empresa.example.com/', {
        ...base,
        transport: net.transport,
      });
      expect(result).toEqual({ ok: false, failure: 'blocked_address' });
    }
  });

  it('segue redirecionamento relativo e devolve a URL final', async () => {
    const net = fakeTransport({
      'https://empresa.example.com/': redirect('/sobre', 301),
      'https://empresa.example.com/sobre': html('<p>sobre</p>'),
    });
    const result = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: net.transport,
    });
    expect(result.ok && result.url.toString()).toBe('https://empresa.example.com/sobre');
    expect(result.ok && result.redirects).toBe(1);
  });

  it('para em laço de redirecionamentos', async () => {
    const net = fakeTransport({
      'https://empresa.example.com/a': redirect('/b'),
      'https://empresa.example.com/b': redirect('/a'),
    });
    const result = await safeFetch('https://empresa.example.com/a', {
      ...base,
      transport: net.transport,
      maxRedirects: 3,
    });
    expect(result).toEqual({ ok: false, failure: 'too_many_redirects' });
    expect(net.calls).toHaveLength(4);
  });

  it('beforeRedirect pode recusar o destino', async () => {
    const net = fakeTransport({
      'https://empresa.example.com/': redirect('https://outra.example.org/'),
    });
    const result = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: net.transport,
      beforeRedirect: async (url) =>
        url.hostname === 'outra.example.org' ? 'robots_disallowed' : null,
    });
    expect(result).toEqual({ ok: false, failure: 'robots_disallowed' });
    expect(net.calls).toHaveLength(1);
  });

  it('DNS sem resposta, erro de rede e corpo grande demais', async () => {
    const semDns = await safeFetch('https://inexistente.example.net/', {
      ...base,
      transport: fakeTransport({}).transport,
    });
    expect(semDns).toEqual({ ok: false, failure: 'unavailable' });

    const caiu = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(caiu).toEqual({ ok: false, failure: 'unavailable' });

    const enorme = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: async () => ({
        status: 200,
        headers: {},
        body: new Uint8Array(),
        truncated: true,
      }),
    });
    expect(enorme).toEqual({ ok: false, failure: 'too_large' });

    const cortado = await safeFetch('https://empresa.example.com/', {
      ...base,
      transport: async (request) => reply(200, 'x'.repeat(5000))(request),
    });
    expect(cortado.ok && cortado.response.truncated).toBe(true);
    expect(cortado.ok && cortado.response.body.length).toBe(1024);
  });
});

describe('nodeTransport (servidor local, sem internet)', () => {
  let server: Server;
  let port = 0;
  const seen: Array<{ host: string | undefined; path: string | undefined }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url });
      if (req.url === '/gz') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(gzipSync(Buffer.from('<p>comprimido</p>')));
      } else if (req.url === '/grande') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('y'.repeat(10_000));
      } else if (req.url === '/declarado') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(50_000) });
        res.end('z'.repeat(50_000));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const request = (path: string, maxBytes: number) =>
    nodeTransport({
      // Nome que não existe: só chega ao servidor porque a conexão usa o endereço fixado.
      url: new URL(`http://fixado.example.com:${port}${path}`),
      address: '127.0.0.1',
      family: 4,
      headers: { 'user-agent': USER_AGENT },
      maxBytes,
      signal: AbortSignal.timeout(5000),
    });

  it('usa o endereço fixado (sem nova resolução) e descomprime gzip', async () => {
    const response = await request('/gz', 1024);
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe('<p>comprimido</p>');
    expect(seen.at(-1)?.host).toBe(`fixado.example.com:${port}`);
  });

  it('corta o corpo no limite de bytes', async () => {
    const response = await request('/grande', 1000);
    expect(response.truncated).toBe(true);
    expect(response.body.length).toBe(1000);
  });

  it('desiste cedo quando o tamanho declarado passa muito do limite', async () => {
    const response = await request('/declarado', 1000);
    expect(response.truncated).toBe(true);
    expect(response.body.length).toBe(0);
  });
});
