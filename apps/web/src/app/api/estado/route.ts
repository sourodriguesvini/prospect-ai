import { isAppRead } from '@/lib/host';
import { buildSystemStatus, type SystemStatusView } from '@/lib/system-status';
import { getLocalAi, getServices } from '@/server/container';
import { userContext } from '@/server/context';

const NO_STORE = { 'cache-control': 'no-store' };
/** Várias abas (ou a volta à janela) dentro deste tempo reaproveitam a mesma leitura. */
const REUSE_MS = 15_000;

/** Última leitura, guardada no processo como os outros objetos únicos do servidor. */
const memo = globalThis as typeof globalThis & {
  __prospectorSystemStatus?: { at: number; view: Promise<SystemStatusView> };
};

/** Uma leitura que falha não derruba as outras: vira "sem leitura" no indicador. */
async function settle<T>(read: () => T | Promise<T>, label: string): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.warn(`[estado] não foi possível ler ${label}`, error);
    return null;
  }
}

async function readStatus(): Promise<SystemStatusView> {
  // Erro de configuração dos serviços não apaga o indicador da IA local, que não depende deles.
  const services = await settle(() => getServices(), 'os serviços');
  const system = services?.system;
  const webResearch = services?.research;
  const [database, localAi, research] = await Promise.all([
    system ? settle(() => system.databaseStatus(), 'o banco') : null,
    settle(() => getLocalAi().status(), 'a IA local'),
    !services
      ? null
      : webResearch
        ? settle(() => webResearch.status(userContext()), 'a pesquisa na internet')
        : ('unavailable' as const),
  ]);
  return buildSystemStatus({ database, localAi, research, now: new Date() });
}

/**
 * Indicadores do rodapé do menu lateral (IA local, pesquisa na internet, banco). Só leitura,
 * com o que os serviços já informam; o menu pede de novo a cada poucos minutos e quando a janela
 * volta ao foco. Não grava nada e não devolve valores de variáveis nem dados de empresas. Só as
 * telas do app (ou a barra de endereço) leem: outro site não dispara leituras em série.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAppRead(request.headers.get('sec-fetch-site'))) {
    return Response.json(
      { error: 'Só as telas do Prospector leem o estado deste computador.' },
      { status: 403, headers: NO_STORE },
    );
  }
  const now = Date.now();
  let last = memo.__prospectorSystemStatus;
  if (!last || now - last.at > REUSE_MS) {
    last = { at: now, view: readStatus() };
    memo.__prospectorSystemStatus = last;
  }
  return Response.json(await last.view, { headers: NO_STORE });
}
