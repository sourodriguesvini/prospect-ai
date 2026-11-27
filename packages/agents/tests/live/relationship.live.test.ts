import type { ApproachAiRequest } from '@prospector/application';
import {
  ApproachAiOutput,
  EMPTY_APPROACH_INSIGHTS,
  MessageDraftText,
  ReplyAnalysis,
} from '@prospector/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { createRelationshipAi } from '../../src/relationship/relationship-ai';
import { createLocalAiRuntime } from '../../src/runtime';

/**
 * IA do Relacionamento contra o Ollama REAL (`pnpm ai:live`). Confere que o modelo padrão segue o
 * esquema JSON e que a saída passa nos contratos; não mede qualidade (isso é `pnpm evals`). Três
 * gerações curtas, uma de cada vez; descarrega o modelo no fim. Dados SINTÉTICOS.
 */
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 3 });
const ai = createRelationshipAi({ gateway: runtime.gateway });
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const REQUEST: ApproachAiRequest = {
  company: {
    displayName: 'Padaria Sintética de Teste Ltda',
    city: 'Campinas',
    uf: 'SP',
    cnaeMain: '1091-1/02 Fabricação de produtos de panificação',
    sizeBand: 'ME',
    primaryDomain: 'padaria-sintetica.example',
    individual: false,
  },
  claims: [
    {
      id: ID(1),
      domain: 'firmographic',
      statement: 'Empresa ativa desde 2020, sediada em Campinas (SP).',
      epistemicType: 'fact',
      band: 'high',
    },
    {
      id: ID(2),
      domain: 'digital_presence',
      statement: 'O site e o perfil no Instagram usam logotipos diferentes.',
      epistemicType: 'fact',
      band: 'medium',
    },
    {
      id: ID(3),
      domain: 'digital_presence',
      statement: 'A última publicação no Instagram é de março de 2026.',
      epistemicType: 'fact',
      band: 'medium',
    },
  ],
  insights: EMPTY_APPROACH_INSIGHTS,
  offer: {
    name: 'Rebranding para pequenos negócios',
    description: 'Revisão da identidade visual e aplicação nos canais.',
    problems: ['Identidade inconsistente entre canais.'],
    needSignals: ['Logotipos diferentes por canal.', 'Canais parados.'],
    deliverables: ['Logotipo revisado.', 'Manual de marca.'],
    valueProps: ['Marca reconhecível em todos os canais.'],
  },
  voice: null,
  agencyName: 'Agência Exemplo',
  optOutText: 'Responda "remover" para não receber mais mensagens.',
  cases: [],
  basis: 'sufficient',
  gaps: ['Sem dados de faturamento.'],
  firstContact: true,
  kind: 'initial_email',
  tone: 'consultative',
  instruction: null,
};

describe('Relacionamento com o Ollama real', () => {
  let model: string;

  beforeAll(async () => {
    const status = await runtime.gateway.status();
    if (status.state !== 'online') throw new Error(`Ollama fora do ar: ${status.message}`);
    const resolved = status.routing.find((route) => route.task === 'copilot')?.resolved;
    if (!resolved) throw new Error('Nenhum modelo do Copiloto instalado (veja a política).');
    model = resolved;
  });

  afterAll(async () => {
    if (model) await runtime.gateway.unload(model);
  });

  it('estratégia e primeira mensagem seguem o esquema e citam só claims existentes', async () => {
    const outcome = await ai.approach(REQUEST);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const parsed = ApproachAiOutput.safeParse(outcome.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? null)).toBe(true);
    if (!parsed.success) return;
    const known = new Set(REQUEST.claims.map((claim) => claim.id));
    for (const point of parsed.data.strategy.evidence) {
      for (const id of point.claimIds) expect(known.has(id)).toBe(true);
    }
    expect(parsed.data.strategy.channel).toBe('email'); // e-mail inicial
    expect(parsed.data.message.body).not.toMatch(/\[[^\]]{2,}\]/); // sem marcadores [nome]
    expect(parsed.data.message.body).toContain('Agência Exemplo'); // quem escreve
    console.info(
      `[live] abordagem em ${outcome.usage?.totalMs} ms, ${outcome.usage?.outputTokens} tokens:\n`,
      JSON.stringify(parsed.data, null, 2),
    );
  });

  it('mensagem de follow-up passa no contrato', async () => {
    const outcome = await ai.message({
      ...REQUEST,
      kind: 'follow_up',
      channel: 'email',
      firstContact: false,
      strategy: null,
      previous: null,
      replyTo: null,
    });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(MessageDraftText.safeParse(outcome.data).success).toBe(true);
    console.info(
      `[live] follow-up em ${outcome.usage?.totalMs} ms:\n`,
      JSON.stringify(outcome.data, null, 2),
    );
  });

  it('pedido de parar o contato é lido como stop_request', async () => {
    const outcome = await ai.analyzeReply({
      companyName: REQUEST.company.displayName,
      companyIndividual: false,
      offerName: REQUEST.offer.name,
      agencyName: REQUEST.agencyName,
      lastOutbound: { subject: 'Identidade da padaria', body: 'Olá! Aqui é da Agência Exemplo...' },
      replyBody: 'Bom dia. Não tenho interesse e peço que me tirem da lista de vocês. Obrigado.',
      cases: [],
    });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const parsed = ReplyAnalysis.safeParse(outcome.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? null)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.classification).toBe('stop_request');
    expect(parsed.data.suggestedReply).toBeNull();
    expect(parsed.data.followUpInDays).toBeNull();
    console.info(
      `[live] resposta em ${outcome.usage?.totalMs} ms:\n`,
      JSON.stringify(parsed.data, null, 2),
    );
  });
});
