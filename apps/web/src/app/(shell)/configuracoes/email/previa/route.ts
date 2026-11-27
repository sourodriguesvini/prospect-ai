import { connection } from 'next/server';
import { EMAIL_PREVIEW_CSP, previewDocument } from '@/lib/email-preview';
import { isLocalRequest } from '@/lib/host';
import { loadEmail } from '@/server/email';

/**
 * Documento da prévia do e-mail de teste (ADR-0016), aberto pelo quadro da tela de e-mail. A
 * política (`EMAIL_PREVIEW_CSP`, aplicada também no proxy) aceita as imagens https cadastradas e
 * nada de script; o quadro na tela ainda é `sandbox`. Sem cache: a prévia muda ao salvar.
 */

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (!isLocalRequest(request.headers.get('host'), request.headers.get('x-forwarded-host'))) {
    return plain(403, 'Host não permitido.');
  }
  const result = await loadEmail((email, ctx) => email.settings(ctx));
  if (result.kind === 'unavailable') return plain(503, result.message);
  const { preview } = result.data;
  if (!preview) return plain(404, 'Sem prévia: salve quem assina primeiro.');
  return new Response(previewDocument(preview.html), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': EMAIL_PREVIEW_CSP,
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
