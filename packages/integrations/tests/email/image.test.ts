import { describe, expect, it } from 'vitest';
import { EMAIL_IMAGE_DOWNLOAD_BYTES, createEmailImageFetcher } from '../../src/email/image';
import { PUBLIC_IP, fakeResolver, fakeTransport, redirect, reply } from '../web/net-fakes';

/** Conferência das imagens da assinatura (ADR-0016) com rede falsa: nada sai para a internet. */

const resolver = fakeResolver({
  'estudio.exemplo.com.br': [PUBLIC_IP],
  'cdn.exemplo.com.br': [PUBLIC_IP],
  'interno.exemplo.com.br': ['10.0.0.8'],
  'www.instagram.com': [PUBLIC_IP],
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('createEmailImageFetcher', () => {
  it('baixa a imagem pelo cliente seguro e devolve status, tipo e bytes', async () => {
    const net = fakeTransport({
      'https://estudio.exemplo.com.br/assets/email/icone.png': reply(200, PNG, {
        'content-type': 'image/png',
      }),
    });
    const fetcher = createEmailImageFetcher({ resolver, transport: net.transport });
    const result = await fetcher.fetch('https://estudio.exemplo.com.br/assets/email/icone.png');
    expect(result).toEqual({
      kind: 'ok',
      status: 200,
      contentType: 'image/png',
      bytes: PNG,
      truncated: false,
    });
    const [call] = net.calls;
    expect(call?.address).toBe(PUBLIC_IP);
    expect(call?.headers.accept).toMatch(/^image\/png/);
    expect(call?.maxBytes).toBe(EMAIL_IMAGE_DOWNLOAD_BYTES);
  });

  it('segue redirecionamento e devolve 404 como resposta (quem julga é o domínio)', async () => {
    const net = fakeTransport({
      'https://estudio.exemplo.com.br/faixa.jpg': redirect('https://cdn.exemplo.com.br/faixa.jpg'),
    });
    const fetcher = createEmailImageFetcher({ resolver, transport: net.transport });
    const result = await fetcher.fetch('https://estudio.exemplo.com.br/faixa.jpg');
    expect(result).toMatchObject({ kind: 'ok', status: 404 });
    expect(net.urls()).toEqual([
      'https://estudio.exemplo.com.br/faixa.jpg',
      'https://cdn.exemplo.com.br/faixa.jpg',
    ]);
  });

  it('recusa endereço interno, http, site restrito e redirecionamento para site restrito', async () => {
    const net = fakeTransport({
      'https://estudio.exemplo.com.br/vai-para-rede-social.png': redirect(
        'https://www.instagram.com/p/foto.png',
      ),
      'https://estudio.exemplo.com.br/vai-para-http.png': redirect(
        'http://cdn.exemplo.com.br/logo.png',
      ),
    });
    const fetcher = createEmailImageFetcher({ resolver, transport: net.transport });
    for (const url of [
      'https://interno.exemplo.com.br/logo.png',
      'http://estudio.exemplo.com.br/logo.png',
      'https://www.instagram.com/static/icone.png',
      'https://estudio.exemplo.com.br/vai-para-rede-social.png',
      'https://estudio.exemplo.com.br/vai-para-http.png',
      'não é url',
    ]) {
      expect(await fetcher.fetch(url), url).toEqual({ kind: 'failed', reason: 'blocked' });
    }
    expect(await fetcher.fetch('https://estudio.exemplo.com.br:8443/logo.png')).toEqual({
      kind: 'failed',
      reason: 'bad_port',
    });
    // Só o primeiro salto dos redirecionamentos chegou à rede; os outros nem saíram.
    expect(net.urls()).toEqual([
      'https://estudio.exemplo.com.br/vai-para-rede-social.png',
      'https://estudio.exemplo.com.br/vai-para-http.png',
    ]);
  });

  it('marca corte no teto de bytes e trata falha de rede como fora do ar', async () => {
    const big = new Uint8Array(EMAIL_IMAGE_DOWNLOAD_BYTES + 10);
    big.set(PNG);
    const net = fakeTransport({
      'https://estudio.exemplo.com.br/enorme.png': reply(200, big, { 'content-type': 'image/png' }),
      'https://estudio.exemplo.com.br/caiu.png': () => {
        throw new Error('ECONNRESET');
      },
    });
    const fetcher = createEmailImageFetcher({ resolver, transport: net.transport });
    const result = await fetcher.fetch('https://estudio.exemplo.com.br/enorme.png');
    expect(result).toMatchObject({ kind: 'ok', truncated: true });
    expect(await fetcher.fetch('https://estudio.exemplo.com.br/caiu.png')).toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
    expect(await fetcher.fetch('https://sem-dns.exemplo.com.br/logo.png')).toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
  });
});
