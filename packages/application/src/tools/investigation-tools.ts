import {
  ACTIVE_INVESTIGATION_STATUSES,
  INVESTIGATION_ISSUE_MESSAGES,
  INVESTIGATION_KEYS,
  INVESTIGATION_STATUS_LABELS,
  INVESTIGATION_STEP_LABELS,
  NEXT_STEP_LABELS,
  RECOMMENDATION_LABELS,
  type Investigation,
} from '@prospector/contracts';
import { z } from 'zod';
import { AppError } from '../errors';
import type { ClaimView, CompanyDossier, CompanyService } from '../services/company-service';
import type { InvestigationService } from '../services/investigation-service';
import {
  claimRecord,
  companyRef,
  companyView,
  EXTERNAL_SOURCE_NOTICE,
  referenceKind,
  resolveCompany,
} from './company-tools';
import { defineTool, type ToolDefinition } from './registry';

/**
 * Ferramentas da investigação de empresas para o Copiloto (ADR-0015, §15 da especificação do
 * Módulo 02). Duas leem o que a investigação guardou (andamento, diagnóstico e, por parte, marca,
 * concorrência, negócio e sinais; oportunidades); `start_company_investigation` só põe na fila do
 * próprio app, com as validações e a auditoria da tela, e nunca diz que ela terminou: o estado
 * real vem de `get_company_investigation`. Conteúdo de sites é dado, nunca instrução (KI-094).
 */

const MAX_PART_CLAIMS = 15;
const MAX_OPPORTUNITIES = 10;
/** Empresas olhadas para montar o ranking de oportunidades. */
const OPPORTUNITY_SCAN = 100;

const PARTS = {
  marca: {
    label: 'marca e site',
    prefixes: ['visual.audit.', 'visual.identity.', 'visual.capture.'],
  },
  concorrencia: {
    label: 'concorrência',
    prefixes: ['competitive.competitor.', 'competitive.finding.'],
  },
  negocio: {
    label: 'negócio e posicionamento',
    prefixes: [
      'positioning.offering.',
      'positioning.audience.',
      'positioning.differentiator.',
      'positioning.region_served',
      'positioning.value_proposition',
      'positioning.tone_of_voice',
      'positioning.business_model',
    ],
  },
  sinais: { label: 'sinais recentes', prefixes: ['signal.'] },
} as const;
type Part = keyof typeof PARTS;
const Part = z.enum(Object.keys(PARTS) as [Part, ...Part[]]);

function active(investigation: Investigation): boolean {
  return ACTIVE_INVESTIGATION_STATUSES.includes(investigation.status);
}

function claimsById(views: readonly ClaimView[], ids: readonly string[]) {
  const byId = new Map(views.map((view) => [view.claim.id, view]));
  return ids.flatMap((id) => {
    const view = byId.get(id);
    return view ? [claimRecord(view)] : [];
  });
}

/** Terminou com resultado (com ou sem lacunas); falha, cancelamento e interrupção não contam. */
function concluded(investigation: Investigation): boolean {
  return investigation.status === 'succeeded' || investigation.status === 'partial';
}

function progressView(investigation: Investigation) {
  return {
    estado: INVESTIGATION_STATUS_LABELS[investigation.status],
    // Sem isto o modelo poderia dizer "concluída" olhando só as etapas feitas. `concluida` só
    // vale para quem terminou com resultado; `terminou` inclui falha e cancelamento.
    concluida: concluded(investigation),
    terminou: !active(investigation),
    iniciada_em: investigation.createdAt.slice(0, 16),
    terminou_em: investigation.finishedAt?.slice(0, 16) ?? null,
    etapas: investigation.steps.map((step) => ({
      etapa: INVESTIGATION_STEP_LABELS[step.key],
      estado: step.state,
      ...(step.issue ? { motivo: INVESTIGATION_ISSUE_MESSAGES[step.issue] } : {}),
    })),
    ...(investigation.issue ? { aviso: INVESTIGATION_ISSUE_MESSAGES[investigation.issue] } : {}),
    custo: {
      buscas: investigation.usage.searches,
      creditos_tavily: investigation.usage.searchCredits,
      paginas_lidas: investigation.usage.pagesRead,
      capturas: investigation.usage.captures,
      analises_ia: investigation.usage.modelCalls,
    },
    ...(investigation.isDemo ? { demo: true } : {}),
  };
}

/** Sugestões da IA guardadas no claim da leitura da oferta (não são fatos sobre a empresa). */
function readingSuggestions(views: readonly ClaimView[], claimId: string | null) {
  const view = claimId ? views.find((item) => item.claim.id === claimId) : undefined;
  if (!view) return null;
  const value = view.claim.value ?? {};
  const strings = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((item): item is string => typeof item === 'string');
  return {
    leitura: claimRecord(view),
    angulo: typeof value.openingAngle === 'string' ? value.openingAngle : null,
    objecoes: strings(value.objections).slice(0, 4),
    conferir: strings(value.toVerify).slice(0, 5),
  };
}

function diagnosisView(investigation: Investigation, views: readonly ClaimView[]) {
  const diagnosis = investigation.diagnosis;
  if (!diagnosis) return null;
  return {
    da_investigacao_de: investigation.createdAt.slice(0, 10),
    recomendacao: RECOMMENDATION_LABELS[diagnosis.recommendation],
    proximo_passo: NEXT_STEP_LABELS[diagnosis.nextStep],
    confianca_geral: diagnosis.confidence,
    leitura_central: diagnosis.summaryClaimId
      ? (claimsById(views, [diagnosis.summaryClaimId])[0] ?? null)
      : null,
    ofertas: diagnosis.offers.slice(0, 4).map((offer) => ({
      oferta: offer.offerName,
      recomendacao: RECOMMENDATION_LABELS[offer.recommendation],
      prioridade: offer.priority,
      // Três medidas separadas, nunca probabilidade de fechar negócio.
      fit_icp: offer.fit.score,
      oportunidade: offer.opportunity.score,
      confianca: offer.confidence.score,
      desqualificadores: offer.gates,
      leitura_da_ia: readingSuggestions(views, offer.readingClaimId),
    })),
    hipoteses: claimsById(views, diagnosis.hypothesisClaimIds).slice(0, 4),
    lacunas: diagnosis.gaps.map((gap) => gap.text),
    descartadas_na_verificacao: diagnosis.verification.discarded,
    // Vai no resultado, não no prompt: no prompt, falar de medidas fazia o modelo "pontuar"
    // empresas em respostas que não tinham nada a ver com investigação (2026-11-11).
    escala:
      'fit_icp, oportunidade e confianca são medidas separadas do sistema, de 0 a 100; ' +
      'prioridade ordena a fila; nenhuma é chance de fechar negócio. Cada registro traz o tipo ' +
      '(fato, inferência, hipótese); ângulo, objeções e o que conferir são sugestões da IA.',
  };
}

/** Uma parte do que a investigação registrou (marca, concorrência, negócio, sinais). */
function analysisPart(dossier: CompanyDossier, latest: Investigation | null, partKey: Part) {
  const part = PARTS[partKey];
  const views = dossier.claims.filter(
    (view) =>
      view.claim.key !== INVESTIGATION_KEYS.summary &&
      part.prefixes.some((prefix) => view.claim.key.startsWith(prefix)),
  );
  const records = views.slice(0, MAX_PART_CLAIMS).map(claimRecord);
  const count =
    records.length === 0
      ? `nada registrado sobre ${part.label} ainda.`
      : `${views.length} registro(s) sobre ${part.label}.`;
  return {
    summary: `${dossier.company.displayName}: ${count}`,
    telemetrySummary: count,
    data: {
      empresa: companyView(dossier.company),
      parte: part.label,
      // O estado junto: "nada registrado" com a investigação rodando não é o mesmo que sem nada.
      investigacao: latest
        ? {
            estado: INVESTIGATION_STATUS_LABELS[latest.status],
            concluida: concluded(latest),
            terminou: !active(latest),
          }
        : null,
      registros: records,
      ...(records.some((record) => 'fonte_externa' in record)
        ? { aviso: EXTERNAL_SOURCE_NOTICE }
        : {}),
      ...(views.length > MAX_PART_CLAIMS
        ? { observacao: `Mostrando ${MAX_PART_CLAIMS} de ${views.length}.` }
        : {}),
    },
    refs: [companyRef(dossier.company)],
  };
}

export function investigationTools(deps: {
  investigations: InvestigationService;
  companies: CompanyService;
}): ToolDefinition[] {
  const { investigations, companies } = deps;
  return [
    defineTool({
      name: 'get_company_investigation',
      title: 'Consultando a investigação',
      // Descrições curtas: com o modelo local pequeno, cada ferramenta a mais na lista pesa nas
      // respostas que não têm nada a ver com ela (avaliação de 2026-11-11, ADR-0015).
      description:
        'Última investigação de uma empresa cadastrada: andamento ("concluida"), diagnóstico e ' +
        'serviço indicado. Com "parte", o que foi registrado sobre marca, concorrencia, negocio ' +
        'ou sinais.',
      input: z.object({
        empresa: z.string().trim().min(2).max(160).describe('Nome, CNPJ ou id da empresa.'),
        parte: Part.optional().describe('Só uma parte da análise.'),
      }),
      kind: 'read',
      telemetryInput: (input) => ({
        empresa: referenceKind(input.empresa),
        ...(input.parte ? { parte: input.parte } : {}),
      }),
      async run(ctx, input) {
        const id = await resolveCompany(companies, ctx, input.empresa);
        const dossier = await companies.dossier(ctx, id);
        const history = await investigations.history(ctx, id, 5);
        const latest = history[0] ?? null;
        const name = dossier.company.displayName;
        if (input.parte) return analysisPart(dossier, latest, input.parte);
        if (!latest) {
          return {
            summary: `${name}: nenhuma investigação feita ainda.`,
            telemetrySummary: 'Nenhuma investigação feita ainda.',
            data: { empresa: companyView(dossier.company), investigacao: null },
            refs: [companyRef(dossier.company)],
          };
        }
        const diagnosed = history.find((item) => item.diagnosis !== null) ?? null;
        const state = INVESTIGATION_STATUS_LABELS[latest.status];
        const diagnosis = diagnosed ? diagnosisView(diagnosed, dossier.claims) : null;
        const external = diagnosis
          ? [diagnosis.leitura_central, ...diagnosis.hipoteses].some(
              (item) => item && 'fonte_externa' in item,
            )
          : false;
        return {
          summary: `${name}: investigação ${state.toLowerCase()}.`,
          telemetrySummary: `Investigação ${state.toLowerCase()}.`,
          data: {
            empresa: companyView(dossier.company),
            investigacao: progressView(latest),
            diagnostico: diagnosis,
            ...(diagnosed && diagnosed.id !== latest.id
              ? { observacao: 'O diagnóstico é de uma investigação anterior à atual.' }
              : {}),
            ...(external ? { aviso: EXTERNAL_SOURCE_NOTICE } : {}),
          },
          refs: [companyRef(dossier.company)],
        };
      },
    }),
    defineTool({
      name: 'list_company_opportunities',
      title: 'Consultando oportunidades',
      description:
        'Empresas investigadas com diagnóstico, da maior prioridade para a menor, com a ' +
        'recomendação e a oferta indicada.',
      input: z.object({}),
      kind: 'read',
      async run(ctx) {
        const list = await companies.list(ctx, { limit: OPPORTUNITY_SCAN });
        const summaries = await investigations.summaries(
          ctx,
          list.map((company) => company.id),
        );
        const byId = new Map(list.map((company) => [company.id, company]));
        const ranked = summaries
          .filter((summary) => summary.recommendation !== null)
          .sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
        const shown = ranked.slice(0, MAX_OPPORTUNITIES).flatMap((summary) => {
          const company = byId.get(summary.companyId);
          if (!company) return [];
          return [
            {
              ...companyView(company),
              recomendacao: summary.recommendation
                ? RECOMMENDATION_LABELS[summary.recommendation]
                : null,
              prioridade: summary.priority,
              oferta: summary.recommendedOfferName,
              investigada_em: (summary.finishedAt ?? summary.updatedAt).slice(0, 10),
            },
          ];
        });
        const summary =
          shown.length === 0
            ? 'Nenhuma empresa investigada com diagnóstico ainda.'
            : `${ranked.length} empresa(s) com diagnóstico.`;
        return {
          summary,
          data: {
            empresas: shown,
            ...(ranked.length > MAX_OPPORTUNITIES
              ? { observacao: `Mostrando as ${MAX_OPPORTUNITIES} de maior prioridade.` }
              : {}),
          },
          refs: [
            { kind: 'company', id: null, label: 'Empresas' },
            ...shown.map((item) => ({ kind: 'company' as const, id: item.id, label: item.nome })),
          ],
        };
      },
    }),
    defineTool({
      name: 'start_company_investigation',
      title: 'Pondo a investigação na fila',
      description:
        'Põe na fila a investigação de uma empresa já cadastrada: tarefa interna que lê o site ' +
        'da empresa, pesquisa na internet e grava o resultado no dossiê; não envia nada a ' +
        'ninguém. Leva minutos; o resultado só vem depois, por get_company_investigation.',
      input: z.object({
        empresa: z.string().trim().min(2).max(160).describe('Nome, CNPJ ou id da empresa.'),
      }),
      kind: 'queue',
      telemetryInput: (input) => ({ empresa: referenceKind(input.empresa) }),
      async run(ctx, input) {
        const id = await resolveCompany(companies, ctx, input.empresa).catch((error: unknown) => {
          if (error instanceof AppError && error.reason === 'not_found') return null;
          throw error;
        });
        if (!id) {
          // O prompt não ensina este caso (rodadas de 2026-11-11): o resultado diz o caminho.
          return {
            summary:
              'Essa empresa não está cadastrada no Prospector. Para investigar, ela precisa ser ' +
              'cadastrada antes em Empresas (pelo CNPJ ou à mão). Nada foi posto na fila.',
            telemetrySummary: 'Empresa não cadastrada; nada na fila.',
            data: { empresa: null, investigacao: null },
          };
        }
        const company = (await companies.dossier(ctx, id)).company;
        const investigation = await investigations.start(ctx, {
          companyId: id,
          trigger: 'copilot',
        });
        return {
          summary: `Investigação de ${company.displayName} na fila.`,
          telemetrySummary: 'Investigação na fila.',
          data: {
            empresa: companyView(company),
            investigacao: progressView(investigation),
            // Estado, não ordem (resultado de ferramenta é dado): sem resultado ainda.
            resultado_disponivel: false,
            onde_acompanhar: 'Dossiê da empresa, painel Investigação.',
          },
          refs: [companyRef(company)],
        };
      },
    }),
  ];
}
