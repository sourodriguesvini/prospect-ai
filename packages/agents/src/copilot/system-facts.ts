import type { DatabaseStatus } from '@prospector/contracts';

/**
 * Estado do banco como o Copiloto o recebe. Mesmo conectado, o Copiloto ainda não lê o conteúdo
 * (sem ferramentas até a IA-2): o texto diz isso para o modelo não afirmar contagens.
 */
export const DATABASE_FACT: Record<DatabaseStatus, string> = {
  ok: 'Banco de dados: conectado, mas nesta versão o Copiloto não lê o conteúdo dele; não sabe quantas empresas, dossiês ou registros existem.',
  not_configured:
    'Banco de dados: ainda não configurado; não há empresas, dossiês nem histórico salvos.',
  schema_missing: 'Banco de dados: acessível, mas sem as tabelas do Prospector.',
  unreachable: 'Banco de dados: inacessível no momento.',
};

export interface CopilotModuleFact {
  label: string;
  /** Fatia do roadmap que entrega o módulo; null = já disponível. */
  plannedSlice: string | null;
  description: string;
}

const TODAY = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'full',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Fatos que o próprio sistema verifica e entrega ao Copiloto a cada pergunta: data, estado do
 * banco e quais módulos existem. Usada pela rota do app e pela avaliação, para as duas verem
 * exatamente o mesmo texto. Nada aqui vem do modelo nem da internet.
 */
export function buildCopilotSystemFacts(input: {
  now: Date;
  database: DatabaseStatus;
  modules: readonly CopilotModuleFact[];
}): string[] {
  const available = input.modules
    .filter((item) => item.plannedSlice === null)
    .map((item) => item.label);
  const planned = input.modules
    .filter((item) => item.plannedSlice !== null)
    .map((item) => `${item.label} (${item.plannedSlice}): ${item.description}`);
  return [
    `Hoje é ${TODAY.format(input.now)} (horário de Brasília).`,
    DATABASE_FACT[input.database],
    `Módulos já disponíveis: ${available.join(', ')}.`,
    `Módulos ainda em construção, com a fatia do roadmap que os entrega: ${planned.join('; ')}.`,
    'Nesta versão o Copiloto não tem ferramentas: não consulta o banco, a internet nem envia nada.',
  ];
}
