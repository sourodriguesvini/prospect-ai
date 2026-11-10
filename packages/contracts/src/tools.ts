import { z } from 'zod';

/**
 * Ferramentas que um modelo local pode pedir (IA-2, docs/14 M1). O modelo só pede; quem executa
 * é um serviço de `@prospector/application`, que valida os argumentos de novo no servidor. Nesta
 * versão todas as ferramentas são de leitura: nenhuma escreve no banco nem age fora do app
 * (regra 2 do CLAUDE.md: ação externa só por item de aprovação).
 */

/** Nome estável de ferramenta (inglês, minúsculas), o mesmo gravado em `tool_calls.tool`. */
export const ToolName = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, {
  error: 'Nome de ferramenta inválido.',
});
export type ToolName = z.infer<typeof ToolName>;

/** ok = executou; error = falhou (argumento inválido, não encontrado, banco fora); denied = política barrou. */
export const ToolStatus = z.enum(['ok', 'error', 'denied']);
export type ToolStatus = z.infer<typeof ToolStatus>;

/** Pedido de ferramenta feito pelo modelo, já normalizado pelo gateway. */
export const ToolCallRequest = z.object({
  /** Identificador da chamada (o do Ollama ou um gerado pelo gateway). */
  id: z.string().min(1).max(80),
  name: ToolName,
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCallRequest = z.infer<typeof ToolCallRequest>;

/**
 * Entidade do Prospector citada por um resultado. A aplicação não conhece endereços de tela: a
 * web converte a referência em link interno.
 */
export const EntityRefKind = z.enum([
  'readiness',
  'offer',
  'icp',
  'proof_asset',
  'voice_guide',
  'compliance',
  'audit',
  'company',
  'claim',
  'discovery_run',
  'opportunity',
  'approach',
  'conversation',
  'pipeline',
  'metrics',
]);
export type EntityRefKind = z.infer<typeof EntityRefKind>;

export const EntityRef = z.object({
  kind: EntityRefKind,
  /** null = a tela da lista ou do módulo, não de um item. */
  id: z.string().min(1).max(80).nullable(),
  label: z.string().trim().min(1).max(120),
});
export type EntityRef = z.infer<typeof EntityRef>;

/** Link para uma tela do próprio app: sempre caminho relativo (nunca outro host). */
export const InternalLink = z.object({
  label: z.string().trim().min(1).max(120),
  href: z
    .string()
    .max(300)
    .regex(/^\/(?![/\\])[^\s]*$/, { error: 'Link interno inválido.' }),
});
export type InternalLink = z.infer<typeof InternalLink>;

/** O que a ferramenta devolve: resumo legível, dados para o modelo e entidades citadas. */
export const ToolResult = z.object({
  status: ToolStatus,
  /** Uma frase em pt-BR, mostrada na tela e gravada em `tool_calls.output_summary`. */
  summary: z.string().max(500),
  /** Dados entregues ao modelo (já limitados em tamanho pelo registro). */
  data: z.unknown(),
  refs: z.array(EntityRef).max(20),
  /** Código estável quando `status` não é ok (`invalid_arguments`, `not_found`…). */
  errorCode: z.string().min(1).max(60).nullable(),
});
export type ToolResult = z.infer<typeof ToolResult>;

/** Ferramenta como o modelo a vê: nome, descrição e parâmetros em JSON Schema. */
export const ToolSpec = z.object({
  name: ToolName,
  /** Rótulo curto em pt-BR para a tela ("Consultando ofertas"). */
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  parameters: z.record(z.string(), z.unknown()),
});
export type ToolSpec = z.infer<typeof ToolSpec>;
