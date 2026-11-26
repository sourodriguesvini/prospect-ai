import 'server-only';
import { MODULES } from '@/lib/modules';
import type { ToolSpec } from '@prospector/contracts';
import { buildCopilotSystemFacts, getServices } from './container';

/** Configurações e o Histórico de ações existem como telas de apoio, fora da jornada principal. */
const SETTINGS_MODULES = [
  { label: 'Configurações', plannedSlice: null, description: 'Proteções e estado da instalação.' },
  {
    label: 'Histórico de ações',
    plannedSlice: null,
    description: 'Registro que só recebe inclusões: o que você, a IA e o sistema fizeram.',
  },
];

/**
 * Fatos que o próprio sistema verifica e entrega ao Copiloto a cada pergunta: data, estado do
 * banco, quais módulos existem e as ferramentas oferecidas (texto montado em @prospector/agents,
 * o mesmo da avaliação).
 */
export async function copilotSystemFacts(
  now: Date,
  tools: readonly Pick<ToolSpec, 'name' | 'title' | 'internet' | 'draft' | 'queue'>[] = [],
): Promise<string[]> {
  const database = await getServices().system.databaseStatus();
  return buildCopilotSystemFacts({
    now,
    database,
    modules: [...MODULES, ...SETTINGS_MODULES],
    tools,
  });
}
