import { describe, expect, it } from 'vitest';
import { resolveConfirmNext, safeNextPath } from './next-path';

const SITE = 'http://localhost:3000';

describe('resolveConfirmNext', () => {
  it.each([
    ['caminho simples', '/convite/abc', '/convite/abc'],
    ['URL do próprio site', 'http://localhost:3000/convite/abc', '/convite/abc'],
    [
      'RedirectTo apontando para /auth/confirm',
      'http://localhost:3000/auth/confirm?next=/convite/abc',
      '/convite/abc',
    ],
    ['raiz do site (fallback do Supabase)', 'http://localhost:3000', '/'],
    ['outra origem', 'https://evil.example/convite/abc', '/app'],
    ['vazio', null, '/app'],
    ['confirm com next externo', 'http://localhost:3000/auth/confirm?next=//evil.example', '/app'],
  ])('%s', (_, raw, expected) => {
    expect(resolveConfirmNext(raw, SITE)).toBe(expected);
  });
});

describe('safeNextPath', () => {
  it.each(['/app', '/o/estudio-norte/configuracoes/equipe', '/convite/abc?x=1'])(
    'aceita caminho interno %s',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ['URL absoluta', 'https://evil.example/'],
    ['protocolo relativo', '//evil.example'],
    ['barra invertida', String.raw`/\evil.example`],
    ['sem barra inicial', 'evil.example'],
    ['javascript:', 'javascript:alert(1)'],
    ['caractere de controle', '/app\n//evil'],
    ['vazio', ''],
    ['não string', null],
  ])('recusa %s', (_, value) => {
    expect(safeNextPath(value)).toBe('/app');
  });
});
