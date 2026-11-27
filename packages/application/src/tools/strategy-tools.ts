import type { EntityRef, EntityStatus, Offer, ReadinessGate } from '@prospector/contracts';
import { z } from 'zod';
import type { RequestContext } from '../context';
import { AppError } from '../errors';
import type { AuditService } from '../services/audit-service';
import type { StrategyService } from '../services/strategy-service';
import { defineTool, type ToolDefinition } from './registry';

/**
 * Ferramentas de leitura da estratégia e da conformidade (F2) para o Copiloto (IA-2). Devolvem
 * campos em português, listas curtas e nunca o texto inteiro de LIA ou política: o modelo recebe
 * o necessário para responder, e a tela tem o resto.
 */

const STATUS_LABEL: Record<EntityStatus, string> = {
  draft: 'rascunho',
  active: 'ativa',
  archived: 'arquivada',
};
const ICP_STATUS_LABEL: Record<EntityStatus, string> = {
  draft: 'rascunho',
  active: 'ativo',
  archived: 'pausado',
};
const LIA_LABEL: Record<string, string> = {
  none: 'nenhuma LIA criada',
  pending: 'LIA em rascunho, aguardando aprovação de quem dirige a agência',
  approved: 'LIA aprovada e em vigor',
  expired: 'LIA aprovada, mas com a revisão vencida',
  revoked: 'LIA revogada',
};

const short = (text: string | null | undefined, max = 200) =>
  !text ? null : text.length > max ? `${text.slice(0, max - 1)}…` : text;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number | null) => (cents === null ? null : brl.format(cents / 100));

function gateView(gate: ReadinessGate) {
  return {
    liberada: gate.ready,
    falta: gate.items
      .filter((item) => !item.ok)
      .map((item) => ({ item: item.label, bloqueia: item.blocking, situacao: item.detail })),
    ok: gate.items.filter((item) => item.ok).map((item) => item.label),
  };
}

/** "1 ativa", "3 ativas", "2 em rascunho", "1 arquivada". */
function countLabel(status: EntityStatus, count: number): string {
  if (status === 'draft') return 'em rascunho';
  return count === 1 ? STATUS_LABEL[status] : `${STATUS_LABEL[status]}s`;
}

const offerName = (offer: Offer) => offer.current?.content.name ?? 'Oferta sem nome';

/** Aceita o id ou o nome (sem diferenciar maiúsculas) e devolve o id da oferta. */
async function resolveOffer(
  strategy: StrategyService,
  ctx: RequestContext,
  reference: string,
): Promise<string> {
  const { snapshot } = await strategy.overview(ctx);
  const wanted = reference.trim().toLowerCase();
  const match =
    snapshot.offers.find((offer) => offer.id === reference.trim()) ??
    snapshot.offers.find((offer) => offerName(offer).toLowerCase() === wanted) ??
    snapshot.offers.find((offer) => offerName(offer).toLowerCase().includes(wanted));
  if (!match) throw new AppError('not_found', 'not_found');
  return match.id;
}

export function strategyTools(deps: {
  strategy: StrategyService;
  audit: AuditService | null;
}): ToolDefinition[] {
  const { strategy } = deps;
  const tools: ToolDefinition[] = [
    defineTool({
      name: 'get_readiness',
      title: 'Conferindo a prontidão',
      description:
        'Mostra se a descoberta de empresas e a abordagem estão liberadas e, se não, o que falta (oferta completa, rubrica, ICP ativo, guia de voz, política de opt-out, LIA aprovada, case público). Use para perguntas como "o que falta para prospectar?" ou "posso abordar empresas?".',
      input: z.object({}),
      kind: 'read',
      async run(ctx) {
        const readiness = await strategy.readiness(ctx);
        const discover = gateView(readiness.discover);
        const approach = gateView(readiness.approach);
        return {
          summary: `Descoberta ${discover.liberada ? 'liberada' : `bloqueada (${discover.falta.length} pendência${discover.falta.length === 1 ? '' : 's'})`}; abordagem ${approach.liberada ? 'liberada' : `bloqueada (${approach.falta.length} pendência${approach.falta.length === 1 ? '' : 's'})`}.`,
          data: { descoberta: discover, abordagem: approach },
          refs: [{ kind: 'readiness', id: null, label: 'Estratégia' }],
        };
      },
    }),
    defineTool({
      name: 'list_offers',
      title: 'Consultando ofertas',
      description:
        'Lista as ofertas da agência (o que ela vende): nome, status, versão, problemas que resolve, entregáveis e faixa de preço. Opcional: filtrar por status (draft = rascunho, active = ativa, archived = arquivada).',
      input: z.object({ status: z.enum(['draft', 'active', 'archived']).optional() }),
      kind: 'read',
      async run(ctx, input) {
        const { snapshot } = await strategy.overview(ctx);
        const offers = snapshot.offers.filter(
          (offer) => !input.status || offer.status === input.status,
        );
        const counts = (['active', 'draft', 'archived'] as const)
          .map(
            (status) => [status, offers.filter((offer) => offer.status === status).length] as const,
          )
          .filter(([, count]) => count !== 0)
          .map(([status, count]) => `${count} ${countLabel(status, count)}`);
        return {
          summary:
            offers.length === 0
              ? 'Nenhuma oferta cadastrada com esse filtro.'
              : `${offers.length} oferta${offers.length === 1 ? '' : 's'}: ${counts.join(', ')}.`,
          data: offers.slice(0, 15).map((offer) => {
            const content = offer.current?.content;
            return {
              id: offer.id,
              nome: offerName(offer),
              status: STATUS_LABEL[offer.status],
              demo: offer.isDemo,
              versao: offer.current?.version ?? null,
              descricao: short(content?.description),
              problemas: content?.problems.slice(0, 5) ?? [],
              entregaveis: content?.deliverables.slice(0, 5) ?? [],
              preco_min: money(content?.priceMinCents ?? null),
              preco_max: money(content?.priceMaxCents ?? null),
            };
          }),
          refs: offers
            .slice(0, 10)
            .map((offer): EntityRef => ({ kind: 'offer', id: offer.id, label: offerName(offer) })),
        };
      },
    }),
    defineTool({
      name: 'get_offer',
      title: 'Abrindo uma oferta',
      description:
        'Detalha uma oferta: conteúdo completo da versão atual, rubrica de auditoria visual (critérios e pesos), modelo de score, ICPs ligados e o que falta para ativar. Informe o id ou o nome da oferta (use list_offers antes se não souber).',
      input: z.object({
        offer: z.string().trim().min(1).max(120).describe('Id ou nome da oferta'),
      }),
      kind: 'read',
      async run(ctx, input) {
        const id = await resolveOffer(strategy, ctx, input.offer);
        const detail = await strategy.offerDetail(ctx, id);
        const content = detail.offer.current?.content;
        const rubric = detail.rubricVersions[0];
        const scoring = detail.scoringModelVersions[0];
        return {
          summary: `Oferta "${offerName(detail.offer)}" (${STATUS_LABEL[detail.offer.status]}, versão ${detail.offer.current?.version ?? '—'}).`,
          data: {
            id: detail.offer.id,
            nome: offerName(detail.offer),
            status: STATUS_LABEL[detail.offer.status],
            demo: detail.offer.isDemo,
            versao: detail.offer.current?.version ?? null,
            versoes_salvas: detail.versions.length,
            descricao: short(content?.description, 600),
            problemas: content?.problems ?? [],
            sinais_de_necessidade: content?.needSignals ?? [],
            desqualificadores: content?.disqualifiers ?? [],
            entregaveis: content?.deliverables ?? [],
            propostas_de_valor: content?.valueProps ?? [],
            preco_min: money(content?.priceMinCents ?? null),
            preco_max: money(content?.priceMaxCents ?? null),
            rubrica: rubric
              ? {
                  versao: rubric.version,
                  criterios: rubric.content.criteria.map((criterion) => ({
                    criterio: criterion.label,
                    peso: criterion.weight,
                  })),
                }
              : null,
            modelo_de_score: scoring
              ? {
                  versao: scoring.version,
                  pesos: scoring.content.weights,
                  cortes: scoring.content.thresholds,
                }
              : null,
            icps: detail.icps.map((icp) => ({
              id: icp.id,
              nome: icp.current?.content.name ?? 'ICP sem nome',
              status: ICP_STATUS_LABEL[icp.status],
            })),
            falta_para_ativar: detail.activationIssues,
          },
          refs: [
            { kind: 'offer', id: detail.offer.id, label: offerName(detail.offer) },
            ...detail.icps.slice(0, 5).map((icp): EntityRef => ({
              kind: 'icp',
              id: icp.id,
              label: icp.current?.content.name ?? 'ICP',
            })),
          ],
        };
      },
    }),
    defineTool({
      name: 'list_icps',
      title: 'Consultando perfis de cliente ideal',
      description:
        'Lista os perfis de cliente ideal (ICP) de todas as ofertas: nome, oferta, status e recorte (CNAEs, UFs, municípios, porte, idade da empresa) e exclusões.',
      input: z.object({}),
      kind: 'read',
      async run(ctx) {
        const { snapshot } = await strategy.overview(ctx);
        const names = new Map(snapshot.offers.map((offer) => [offer.id, offerName(offer)]));
        return {
          summary:
            snapshot.icps.length === 0
              ? 'Nenhum ICP cadastrado.'
              : `${snapshot.icps.length} ICP${snapshot.icps.length === 1 ? '' : 's'} (${snapshot.icps.filter((icp) => icp.status === 'active').length} ativo${snapshot.icps.filter((icp) => icp.status === 'active').length === 1 ? '' : 's'}).`,
          data: snapshot.icps.slice(0, 15).map((icp) => {
            const content = icp.current?.content;
            return {
              id: icp.id,
              nome: content?.name ?? 'ICP sem nome',
              oferta: names.get(icp.offerId) ?? null,
              status: ICP_STATUS_LABEL[icp.status],
              demo: icp.isDemo,
              versao: icp.current?.version ?? null,
              descricao: short(content?.description),
              cnaes: content?.filters.cnaes.slice(0, 20) ?? [],
              ufs: content?.filters.ufs ?? [],
              municipios: content?.filters.municipalities.slice(0, 20) ?? [],
              portes: content?.filters.sizes ?? [],
              idade_min_anos: content?.filters.minAgeYears ?? null,
              idade_max_anos: content?.filters.maxAgeYears ?? null,
              exclusoes: {
                cnaes: content?.exclusions.cnaes.length ?? 0,
                municipios: content?.exclusions.municipalities.length ?? 0,
                cnpjs: content?.exclusions.cnpjRoots.length ?? 0,
                dominios: content?.exclusions.domains.length ?? 0,
              },
            };
          }),
          refs: snapshot.icps.slice(0, 10).map((icp): EntityRef => ({
            kind: 'icp',
            id: icp.id,
            label: icp.current?.content.name ?? 'ICP',
          })),
        };
      },
    }),
    defineTool({
      name: 'list_proof_assets',
      title: 'Consultando cases',
      description:
        'Lista os cases (provas de trabalho) da agência que não foram arquivados: título, segmento, resumo, resultados e se o cliente autorizou citar publicamente (publico). Só cite em mensagens os cases com publico = true.',
      input: z.object({}),
      kind: 'read',
      async run(ctx) {
        const { snapshot } = await strategy.overview(ctx);
        const cases = snapshot.proofAssets.filter((asset) => asset.archivedAt === null);
        const publicCount = cases.filter((asset) => asset.publicOk).length;
        return {
          summary:
            cases.length === 0
              ? 'Nenhum case cadastrado.'
              : `${cases.length} case${cases.length === 1 ? '' : 's'}, ${publicCount} com autorização para citar.`,
          data: cases.slice(0, 15).map((asset) => ({
            id: asset.id,
            titulo: asset.title,
            segmento: asset.segment,
            resumo: short(asset.summary, 300),
            resultados: short(asset.results, 300),
            publico: asset.publicOk,
            demo: asset.isDemo,
          })),
          refs: cases
            .slice(0, 10)
            .map((asset): EntityRef => ({ kind: 'proof_asset', id: asset.id, label: asset.title })),
        };
      },
    }),
    defineTool({
      name: 'get_compliance_status',
      title: 'Conferindo a conformidade',
      description:
        'Mostra a situação da LGPD para abordagens: se a avaliação de legítimo interesse (LIA) está aprovada e até quando vale, e se a política de opt-out está definida. Não aprova nem altera nada.',
      input: z.object({}),
      kind: 'read',
      async run(ctx) {
        const overview = await strategy.compliance(ctx);
        const effective = overview.effectiveLia;
        const policy = overview.contactPolicyVersions[0];
        return {
          summary: `${LIA_LABEL[effective.status] ?? effective.status}; política de opt-out ${policy ? `na versão ${policy.version}` : 'não definida'}.`,
          data: {
            hoje: overview.today,
            lia: {
              situacao: LIA_LABEL[effective.status] ?? effective.status,
              versao: effective.version?.version ?? null,
              revisar_ate: effective.version?.reviewDueOn ?? null,
              versoes_salvas: overview.liaVersions.length,
            },
            politica_opt_out: policy
              ? { versao: policy.version, agencia: policy.content.agencyName }
              : null,
            observacao:
              'Aprovar a LIA é decisão de quem dirige a agência, na tela Conformidade; o Copiloto não aprova.',
          },
          refs: [{ kind: 'compliance', id: null, label: 'Conformidade' }],
        };
      },
    }),
  ];

  if (deps.audit) {
    const audit = deps.audit;
    tools.push(
      defineTool({
        name: 'list_recent_activity',
        title: 'Consultando o registro de auditoria',
        description:
          'Lista as ações mais recentes registradas na auditoria (quem fez, o quê, quando), sem o conteúdo. Use para "o que foi feito hoje?" ou "o que mudou na estratégia?".',
        input: z.object({ limit: z.number().int().min(1).max(30).default(15) }),
        kind: 'read',
        async run(ctx, input) {
          const entries = await audit.listRecent(ctx, input.limit);
          return {
            summary:
              entries.length === 0
                ? 'Nenhuma ação registrada ainda.'
                : entries.length === 1
                  ? '1 ação mais recente.'
                  : `${entries.length} ações mais recentes.`,
            data: entries.map((entry) => ({
              acao: entry.action,
              entidade: entry.entityType,
              quem:
                entry.actorType === 'user'
                  ? 'você'
                  : `${entry.actorType}${entry.actorLabel ? ` (${entry.actorLabel})` : ''}`,
              quando: entry.occurredAt,
            })),
            refs: [{ kind: 'audit', id: null, label: 'Auditoria' }],
          };
        },
      }),
    );
  }
  return tools;
}
