import { describe, expect, it } from 'vitest';
import {
  companyCommands,
  CREATE_COMMANDS,
  filterCommands,
  interfaceCommands,
  searchInCompaniesCommand,
  normalize,
  screenCommands,
} from './commands';

const all = [...screenCommands(), ...CREATE_COMMANDS, ...interfaceCommands(false)];
const labels = (query: string) => filterCommands(all, query).map((command) => command.label);

describe('normalize', () => {
  it('ignora acento e caixa', () => {
    expect(normalize('  Configuração ')).toBe('configuracao');
    expect(normalize('INÍCIO')).toBe('inicio');
  });
});

describe('filterCommands', () => {
  it('sem busca devolve tudo, na ordem original', () => {
    expect(filterCommands(all, '   ')).toHaveLength(all.length);
  });

  it('acha sem acento e põe primeiro quem começa com o termo', () => {
    expect(labels('config')[0]).toBe('Configuração');
    expect(labels('estrateg')[0]).toBe('Estratégia');
  });

  it('exige todas as palavras, em qualquer ordem', () => {
    expect(labels('nova oferta')).toEqual(['Nova oferta']);
    expect(labels('oferta nova')).toEqual(['Nova oferta']);
    expect(labels('tema escuro')[0]).toBe('Tema escuro');
  });

  it('acha por palavra-chave e pela linha de apoio', () => {
    expect(labels('cnpj')).toContain('Adicionar empresa');
    expect(labels('lgpd')).toEqual(
      expect.arrayContaining(['LIA (legítimo interesse)', 'Texto de opt-out']),
    );
  });

  it('nada encontrado devolve lista vazia', () => {
    expect(labels('xyzzy')).toEqual([]);
  });
});

describe('comandos', () => {
  it('telas do menu mostram o atalho e as em breve dizem a fatia', () => {
    const screens = screenCommands();
    expect(screens.find((c) => c.label === 'Empresas')?.keys).toEqual(['G', 'E']);
    expect(screens.find((c) => c.label === 'Descoberta')?.hint).toBe('Em breve (F4)');
  });

  it('o rótulo de recolher o menu acompanha o estado', () => {
    expect(interfaceCommands(false)[0]?.label).toBe('Recolher o menu lateral');
    expect(interfaceCommands(true)[0]?.label).toBe('Expandir o menu lateral');
    // No celular (gaveta) não há o que recolher.
    expect(interfaceCommands(false, false).map((item) => item.id)).not.toContain('interface:menu');
  });

  it('empresa de demonstração leva o selo', () => {
    const [command] = companyCommands([
      { id: 'a', name: 'Ateliê', place: 'Recife/PE', isDemo: true, href: '/empresas/a' },
    ]);
    expect(command).toMatchObject({
      group: 'Empresas',
      hint: 'Recife/PE',
      demo: true,
      action: { kind: 'navigate', href: '/empresas/a' },
    });
  });
});

describe('lista vazia', () => {
  it('oferece buscar o texto na tela Empresas', () => {
    const command = searchInCompaniesCommand('  Padaria São João ');
    expect(command.label).toBe('Buscar “Padaria São João” em Empresas');
    expect(command.action).toEqual({
      kind: 'navigate',
      href: '/empresas?busca=Padaria%20S%C3%A3o%20Jo%C3%A3o',
    });
  });
});
