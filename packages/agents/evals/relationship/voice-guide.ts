import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoiceGuideContent } from '@prospector/contracts';
import { z } from 'zod';

/**
 * Guia de voz EXPERIMENTAL (proposta de 26/11, Frente 2). Não é usado pelo app: o guia em uso é
 * o de Configurações › Estratégia › Voz, e nada aqui o altera sozinho. Serve para preparar a
 * reconstrução da voz com exemplos e notas, e para as avaliações compararem prompts com e sem ele.
 *
 * Cada exemplo tem origem (`usuario` ou `ficticio`) e, quando avaliado, uma nota de 1 a 5 com o
 * porquê. Só exemplos com nota 4 ou 5 viram "exemplos bons" no formato do guia em uso
 * (`toVoiceGuideContent`); notas 1 e 2 viram "exemplos ruins". Promover o resultado para o guia
 * em uso é decisão da pessoa, revisando o texto final (não há mudança automática).
 */
export const VoiceExample = z.object({
  id: z.string().min(1).max(40),
  /** `ficticio`: escrito para o teste, com empresa e pessoa inventadas. */
  origin: z.enum(['usuario', 'ficticio']),
  /** Estratégia de abordagem que o exemplo ilustra. */
  strategy: z.enum([
    'networking',
    'consultiva',
    'oportunidade',
    'demanda explicita',
    'apresentacao',
    'pedido de direcionamento',
    'reengajamento',
    'follow-up',
    'objecoes',
  ]),
  text: z.string().min(1).max(2000),
  /** 1 (não enviaria) a 5 (enviaria como está); null = ainda não avaliado. */
  rating: z.number().int().min(1).max(5).nullable(),
  /** Por que a nota (o que soa natural ou artificial). */
  note: z.string().max(500).nullable(),
});
export type VoiceExample = z.infer<typeof VoiceExample>;

export const ExperimentalVoiceGuide = z.object({
  /** Marcas obrigatórias: o arquivo nunca passa por guia real nem por dado de cliente. */
  experimental: z.literal(true),
  /**
   * Sempre sintético: este arquivo vai para o git. Exemplos reais (mensagens da agência, nomes de
   * empresas, que podem ser de MEI) ficam fora dele (docs/comunicacao-frente-2-experimental.md §8).
   */
  synthetic: z.literal(true),
  status: z.literal('não ativado'),
  /** Aviso para quem lê o arquivo; não vai para o modelo. */
  notice: z.string().min(1).max(500),
  /** Vai para o modelo como `voz.resumo`: só a voz, sem avisos de teste. */
  summary: z.string().min(1).max(1000),
  principles: z.array(z.string().min(1).max(300)).max(15),
  avoid: z.array(z.string().min(1).max(300)).max(15),
  examples: z
    .array(VoiceExample)
    .max(40)
    .refine((items) => items.every((item) => item.origin === 'ficticio'), {
      message: 'O guia versionado só aceita exemplos fictícios.',
    }),
});
export type ExperimentalVoiceGuide = z.infer<typeof ExperimentalVoiceGuide>;

/** Agência fictícia dos exemplos de `voice-guide.experimental.json`. */
export const EXPERIMENTAL_AGENCY = 'Ateliê Cobalto';

const here = dirname(fileURLToPath(import.meta.url));

/** Lê e valida o guia experimental versionado ao lado deste arquivo. */
export function loadExperimentalVoiceGuide(): ExperimentalVoiceGuide {
  return ExperimentalVoiceGuide.parse(
    JSON.parse(readFileSync(join(here, 'voice-guide.experimental.json'), 'utf8')),
  );
}

/**
 * Troca o nome da agência fictícia pelo da agência do caso, para o modelo não copiar um nome
 * que não é o de quem assina (sem agência no caso, os exemplos ficam como estão).
 */
export function withAgency(
  content: VoiceGuideContent,
  agencyName: string | null,
): VoiceGuideContent {
  if (!agencyName) return content;
  const swap = (text: string) => text.replaceAll(EXPERIMENTAL_AGENCY, agencyName);
  return {
    summary: swap(content.summary),
    principles: content.principles.map(swap),
    avoid: content.avoid.map(swap),
    goodExamples: content.goodExamples.map(swap),
    badExamples: content.badExamples.map(swap),
  };
}

/**
 * Converte para o formato do guia em uso (o que a IA recebe em `voz`), escolhendo os exemplos
 * pela nota. O resultado passa pelo contrato do guia em uso (limite de 5 exemplos de cada lado).
 */
export function toVoiceGuideContent(guide: ExperimentalVoiceGuide): VoiceGuideContent {
  const rated = (test: (rating: number) => boolean) =>
    guide.examples
      .filter((example) => example.rating !== null && test(example.rating))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 5)
      .map((example) => example.text);
  return VoiceGuideContent.parse({
    summary: guide.summary,
    principles: guide.principles,
    avoid: guide.avoid,
    goodExamples: rated((rating) => rating >= 4),
    badExamples: rated((rating) => rating <= 2),
  });
}
