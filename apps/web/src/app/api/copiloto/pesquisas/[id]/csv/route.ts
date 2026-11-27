import { isAppError } from '@prospector/application';
import {
  RESEARCH_AUDIENCE_LABELS,
  RESEARCH_SEGMENT_LABELS,
  type ResearchItemView,
} from '@prospector/contracts';
import { toCsv } from '@/lib/csv';
import { isAppRead } from '@/lib/host';
import { getServices } from '@/server/container';
import { userContext } from '@/server/context';

const NO_STORE = { 'cache-control': 'no-store' };

const HEADER = [
  'tipo',
  'nome',
  'profissao',
  'cargo',
  'organizacao',
  'cidade',
  'uf',
  'local_conferido',
  'papel_para_o_perfil',
  'segmento',
  'por_que',
  'email_publico',
  'telefone_publico',
  'site',
  'perfil',
  'fonte',
  'trecho_da_fonte',
  'visto_na_fonte_em',
  'coberto_pela_lia',
  'lia_versao',
  'pode_abordar_com_aprovacao',
  'apagar_ate',
] as const;

const BASIS: Record<ResearchItemView['locationBasis'], string> = {
  quote: 'no trecho da fonte',
  query: 'pela região da busca',
  none: '',
};

function row(item: ResearchItemView) {
  return [
    item.kind === 'person' ? 'profissional' : 'organização',
    item.name,
    item.profession,
    item.roleTitle,
    item.organization,
    item.city,
    item.uf,
    BASIS[item.locationBasis],
    RESEARCH_AUDIENCE_LABELS[item.audienceRole],
    RESEARCH_SEGMENT_LABELS[item.segment],
    item.fitReason,
    item.publicEmail,
    item.publicPhone,
    item.website,
    item.profileUrl,
    item.sourceUrl,
    item.sourceQuote,
    item.verifiedAt,
    item.kind === 'person' ? item.approachable : null,
    item.kind === 'person' ? item.liaVersion : null,
    item.approachable,
    item.retentionUntil,
  ];
}

function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'pesquisa'
  );
}

/**
 * Baixa os resultados da pesquisa em CSV, para revisão fora do app. Só as telas do Prospector (ou
 * a barra de endereço) baixam; cada download fica na auditoria (`copilot.research.exported`) e
 * quem pediu opt-out não sai no arquivo. O arquivo não autoriza contato: abordar alguém continua
 * passando pela aprovação no app, e a cópia baixada segue o prazo de `apagar_ate`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isAppRead(request.headers.get('sec-fetch-site'))) {
    return Response.json(
      { error: 'Só as telas do Prospector baixam os resultados.' },
      { status: 403, headers: NO_STORE },
    );
  }
  const { copilotResearch } = getServices();
  if (!copilotResearch) {
    return Response.json(
      { error: 'O banco não está configurado.' },
      { status: 503, headers: NO_STORE },
    );
  }
  const { id } = await params;
  try {
    const { research, items } = await copilotResearch.exportItems(userContext(), id);
    // Data de hoje no fuso do app (o mesmo das telas), no formato AAAA-MM-DD.
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const name = `pesquisa-${slug(`${research.requestedCount} ${research.audience}`)}-${date}.csv`;
    return new Response(toCsv(HEADER, items.map(row)), {
      headers: {
        ...NO_STORE,
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'not_found' || error.code === 'validation') {
        return Response.json(
          { error: 'Pesquisa não encontrada.' },
          { status: 404, headers: NO_STORE },
        );
      }
      if (error.code === 'unavailable') {
        return Response.json({ error: error.message }, { status: 503, headers: NO_STORE });
      }
    }
    console.warn('[pesquisa] exportação falhou', error);
    return Response.json(
      { error: 'Não foi possível gerar o arquivo agora. Tente de novo.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
