import { isLocalRequest } from '@/lib/host';
import { getServices } from '@/server/container';
import { userContext } from '@/server/context';

/**
 * Imagem de uma captura de marca (ADR-0015), lida pelo serviço da investigação: só sai se um
 * claim de captura da própria empresa apontar para ela (o caminho é conferido de novo na pasta).
 * Esta rota termina em `.jpg` e por isso fica fora do proxy: a checagem de Host local (ADR-0007,
 * regra 3a) é feita aqui. Sem cache: imagem apagada não fica no navegador.
 */

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(
  request: Request,
  context: RouteContext<'/empresas/[id]/capturas/[arquivo]'>,
): Promise<Response> {
  if (!isLocalRequest(request.headers.get('host'), request.headers.get('x-forwarded-host'))) {
    return plain(403, 'Host não permitido.');
  }
  const { id, arquivo } = await context.params;
  const { investigations } = getServices();
  const found = investigations
    ? await investigations.captureImage(userContext(), id, arquivo).catch(() => null)
    : null;
  if (!found) return plain(404, 'Captura não encontrada.');
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'Content-Type': found.mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': `inline; filename="${arquivo}"`,
    },
  });
}
