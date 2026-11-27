import { describe, expect, it } from 'vitest';
import {
  EMAIL_IMAGE_MAX_BYTES,
  emailImageProblem,
  imageDimensions,
  sniffImageFormat,
  type FetchedEmailImage,
} from '../../src/relationship/email-image';

/** Cabeçalho PNG mínimo (assinatura + IHDR) com largura e altura. */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const bytes = new Uint8Array(Math.max(33, padTo));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** JPEG mínimo: SOI, um APP0 curto e o SOF0 com altura e largura. */
function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03,
    0, 0, 0, 0,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, height);
  view.setUint16(15, width);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

const text = (value: string) => new TextEncoder().encode(value);

function ok(bytes: Uint8Array, contentType: string | null = 'image/png'): FetchedEmailImage {
  return { kind: 'ok', status: 200, contentType, bytes, truncated: false };
}

describe('sniffImageFormat', () => {
  it('reconhece os formatos pelos bytes, não pela extensão', () => {
    expect(sniffImageFormat(png(40, 40))).toBe('png');
    expect(sniffImageFormat(jpeg(900, 300))).toBe('jpeg');
    expect(sniffImageFormat(gif(40, 40))).toBe('gif');
    expect(sniffImageFormat(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImageFormat(text('﻿  <?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe('svg');
    expect(sniffImageFormat(text('<svg viewBox="0 0 1 1"/>'))).toBe('svg');
    expect(sniffImageFormat(text('\n<!DOCTYPE html><html lang="pt-BR">'))).toBe('html');
    expect(sniffImageFormat(text('{"erro":true}'))).toBe('other');
    expect(sniffImageFormat(new Uint8Array())).toBe('other');
  });
});

describe('imageDimensions', () => {
  it('lê largura e altura de PNG, JPEG e GIF', () => {
    expect(imageDimensions(png(900, 300), 'png')).toEqual({ width: 900, height: 300 });
    expect(imageDimensions(jpeg(900, 300), 'jpeg')).toEqual({ width: 900, height: 300 });
    expect(imageDimensions(gif(40, 20), 'gif')).toEqual({ width: 40, height: 20 });
  });

  it('devolve null com cabeçalho cortado ou formato sem leitura', () => {
    expect(imageDimensions(png(40, 40).subarray(0, 20), 'png')).toBeNull();
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), 'jpeg')).toBeNull();
    expect(imageDimensions(text('<svg/>'), 'svg')).toBeNull();
  });
});

describe('emailImageProblem', () => {
  it('aceita a faixa e os ícones publicados no site (JPG 900×300 e PNG 40×40)', () => {
    expect(emailImageProblem('banner', ok(jpeg(900, 300), 'image/jpeg'))).toBeNull();
    expect(emailImageProblem('icon', ok(png(40, 40)))).toBeNull();
    expect(emailImageProblem('icon', ok(gif(20, 20), 'image/gif; charset=binary'))).toBeNull();
  });

  it('recusa página da web no lugar da imagem (o caso do teste sem ícones)', () => {
    const page = ok(text('<!doctype html><html><body>Arquivo:LinkedIn</body></html>'), 'text/html');
    expect(emailImageProblem('icon', page)).toMatch(/abre uma página, não a imagem/);
    // Página grande (como a de um banco de vetores) também é "página", não "imagem pesada".
    const bigPage = new Uint8Array(EMAIL_IMAGE_MAX_BYTES.icon * 3);
    bigPage.set(text('<!DOCTYPE html><html lang="pt-BR"><head>'));
    expect(
      emailImageProblem('icon', {
        ...ok(bigPage, 'text/html'),
        truncated: true,
      } as FetchedEmailImage),
    ).toMatch(/abre uma página/);
  });

  it('recusa SVG e WebP, que não aparecem em todos os programas de e-mail', () => {
    expect(emailImageProblem('icon', ok(text('<svg/>'), 'image/svg+xml'))).toMatch(/SVG/);
    expect(emailImageProblem('banner', ok(text('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'))).toMatch(
      /WebP/,
    );
    expect(emailImageProblem('banner', ok(text('%PDF-1.7'), 'application/pdf'))).toMatch(
      /não é PNG, JPG nem GIF/,
    );
  });

  it('explica endereço fora do ar, bloqueado, inexistente ou com erro', () => {
    expect(emailImageProblem('banner', { kind: 'failed', reason: 'unavailable' })).toMatch(
      /sem resposta/,
    );
    expect(emailImageProblem('banner', { kind: 'failed', reason: 'blocked' })).toMatch(
      /não pode ser usado/,
    );
    expect(emailImageProblem('icon', { kind: 'failed', reason: 'bad_port' })).toMatch(/sem porta/);
    const status = (code: number): FetchedEmailImage => ({
      kind: 'ok',
      status: code,
      contentType: 'text/html',
      bytes: text('<html>'),
      truncated: false,
    });
    expect(emailImageProblem('icon', status(404))).toMatch(/erro 404/);
    expect(emailImageProblem('icon', status(503))).toMatch(/HTTP 503/);
  });

  it('recusa arquivo pesado demais ou cortado no download', () => {
    const heavy = png(1072, 357, EMAIL_IMAGE_MAX_BYTES.banner + 1);
    expect(emailImageProblem('banner', ok(heavy))).toMatch(/até 1,0 MB/);
    const icon = png(40, 40, EMAIL_IMAGE_MAX_BYTES.icon + 1);
    expect(emailImageProblem('icon', ok(icon))).toMatch(/até 200 KB/);
    const cut: FetchedEmailImage = {
      kind: 'ok',
      status: 200,
      contentType: 'image/png',
      bytes: png(40, 40, 2 * 1024 * 1024),
      truncated: true,
    };
    expect(emailImageProblem('banner', cut)).toMatch(/mais de 1,0 MB/);
    expect(emailImageProblem('icon', { kind: 'failed', reason: 'too_large' })).toMatch(
      /O ícone tem mais de 200 KB/,
    );
  });

  it('recusa imagem entregue com tipo que não é de imagem', () => {
    expect(emailImageProblem('icon', ok(png(40, 40), 'text/plain'))).toMatch(/"text\/plain"/);
    // Tipo estranho (texto livre do site) não vai para a tela.
    const odd = ok(png(40, 40), 'veja instruções em https://exemplo.invalid/leia-isto');
    const message = emailImageProblem('icon', odd);
    expect(message).toMatch(/com outro tipo/);
    expect(message).not.toContain('instruções');
    // Sem cabeçalho de tipo, vale o que os bytes dizem.
    expect(emailImageProblem('icon', ok(png(40, 40), null))).toBeNull();
  });

  it('recusa faixa estreita e ícone pequeno ou não quadrado', () => {
    expect(emailImageProblem('banner', ok(png(400, 150)))).toMatch(/400 px de largura/);
    expect(emailImageProblem('banner', ok(png(536, 179)))).toBeNull();
    expect(emailImageProblem('icon', ok(png(40, 30)))).toMatch(/não é quadrado \(40×30 px\)/);
    expect(emailImageProblem('icon', ok(png(16, 16)))).toMatch(/16 px/);
    expect(emailImageProblem('icon', ok(png(40, 40).subarray(0, 20)))).toMatch(
      /tamanho desta imagem/,
    );
  });
});
