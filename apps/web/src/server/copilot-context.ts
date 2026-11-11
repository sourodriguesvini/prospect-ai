import 'server-only';
import { MODULES } from '@/lib/modules';
import type { ToolSpec } from '@prospector/contracts';
import { buildCopilotSystemFacts, getServices } from './container';

/** Configuração e Auditoria existem como telas de apoio, fora da navegação principal. */
const SETTINGS_MODULES = [
  { label: 'Configuração', plannedSlice: null, description: 'Proteções e estado da instalação.' },
  { label: 'Auditoria', plannedSlice: null, description: 'Registro append-only das ações.' },
];

/**
 * Fatos que o próprio sistema verifica e entrega ao Copiloto a cada pergunta: data, estado do
 * banco, quais módulos existem e as ferramentas oferecidas (texto montado em @prospector/agents,
 * o mesmo da avaliação).
 */
export async function copilotSystemFacts(
  now: Date,
  tools: readonly Pick<ToolSpec, 'name' | 'title' | 'internet'>[] = [],
): Promise<string[]> {
  const database = await getServices().system.databaseStatus();
  return buildCopilotSystemFacts({
    now,
    database,
    modules: [...MODULES, ...SETTINGS_MODULES],
    tools,
  });
}
