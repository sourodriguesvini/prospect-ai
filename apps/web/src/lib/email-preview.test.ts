import { describe, expect, it } from 'vitest';
import {
  EMAIL_PREVIEW_CSP,
  isEmailPreviewPath,
  previewDocument,
  previewVersion,
} from './email-preview';

describe('prévia do e-mail', () => {
  it('links abrem fora do quadro, sem mudar o resto do HTML', () => {
    const html =
      '<!DOCTYPE html>\n<html><head lang="pt">\n<title>x</title></head><body>a</body></html>';
    const doc = previewDocument(html);
    expect(doc).toContain('<head lang="pt">\n<base target="_blank">\n<title>');
    expect(doc.replace('\n<base target="_blank">', '')).toBe(html);
    expect(previewDocument('<p>sem cabeça</p>')).toBe('<base target="_blank"><p>sem cabeça</p>');
  });

  it('a política da prévia não aceita script e só enquadra no próprio app', () => {
    expect(EMAIL_PREVIEW_CSP).toContain("default-src 'none'");
    expect(EMAIL_PREVIEW_CSP).toContain("frame-ancestors 'self'");
    expect(EMAIL_PREVIEW_CSP).not.toMatch(/script-src/);
    expect(isEmailPreviewPath('/configuracoes/email/previa')).toBe(true);
    expect(isEmailPreviewPath('/configuracoes/email')).toBe(false);
    expect(isEmailPreviewPath('/configuracoes/email/previa/x')).toBe(false);
  });

  it('a versão muda com o conteúdo', () => {
    expect(previewVersion('a')).toBe(previewVersion('a'));
    expect(previewVersion('a')).not.toBe(previewVersion('b'));
  });
});
