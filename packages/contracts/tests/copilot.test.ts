import { describe, expect, it } from 'vitest';
import {
  CopilotEvent,
  CopilotTurnRequest,
  InternalLink,
  RenameThreadInput,
  ToolCallRequest,
  ToolResult,
  threadTitleFrom,
} from '../src';

const THREAD = '11111111-1111-4111-8111-111111111111';

describe('CopilotTurnRequest (IA-2)', () => {
  it('aceita só a pergunta nova e o id da conversa', () => {
    expect(CopilotTurnRequest.parse({ schemaVersion: 2, threadId: null, message: 'oi' })).toEqual({
      schemaVersion: 2,
      threadId: null,
      message: 'oi',
      think: false,
    });
    expect(
      CopilotTurnRequest.safeParse({ schemaVersion: 2, threadId: THREAD, message: 'oi' }).success,
    ).toBe(true);
  });

  it('recusa o formato antigo, id inválido e pergunta vazia ou longa demais', () => {
    for (const body of [
      { schemaVersion: 1, messages: [{ role: 'user', content: 'oi' }] },
      { schemaVersion: 2, threadId: 'abc', message: 'oi' },
      { schemaVersion: 2, threadId: null, message: '   ' },
      { schemaVersion: 2, threadId: null, message: 'x'.repeat(8001) },
      { schemaVersion: 2, message: 'oi' },
    ]) {
      expect(CopilotTurnRequest.safeParse(body).success).toBe(false);
    }
  });
});

describe('ferramentas', () => {
  it('nome de ferramenta só em snake_case minúsculo', () => {
    expect(
      ToolCallRequest.safeParse({ id: 'c1', name: 'list_offers', arguments: {} }).success,
    ).toBe(true);
    for (const name of ['ListOffers', 'list-offers', 'x', '1abc', 'apagar tudo']) {
      expect(ToolCallRequest.safeParse({ id: 'c1', name, arguments: {} }).success).toBe(false);
    }
  });

  it('link interno só aponta para dentro do app', () => {
    expect(InternalLink.safeParse({ label: 'Oferta', href: '/configuracoes/x' }).success).toBe(
      true,
    );
    for (const href of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/com espaço',
      'relativo',
    ]) {
      expect(InternalLink.safeParse({ label: 'x', href }).success).toBe(false);
    }
  });

  it('resultado de ferramenta tem resumo curto e no máximo 20 referências', () => {
    const base = { status: 'ok', summary: 'ok', data: null, refs: [], errorCode: null };
    expect(ToolResult.safeParse(base).success).toBe(true);
    expect(ToolResult.safeParse({ ...base, summary: 'x'.repeat(501) }).success).toBe(false);
    const ref = { kind: 'offer', id: 'a', label: 'A' };
    expect(ToolResult.safeParse({ ...base, refs: Array(21).fill(ref) }).success).toBe(false);
  });

  it('eventos novos do Copiloto passam pelo contrato', () => {
    for (const event of [
      { type: 'thread', threadId: THREAD, title: 'oi', created: true },
      { type: 'tool_call', id: 'c1', name: 'list_offers', title: 'Consultando ofertas' },
      {
        type: 'tool_result',
        id: 'c1',
        name: 'list_offers',
        status: 'ok',
        summary: '1 oferta.',
        links: [{ label: 'Branding', href: '/configuracoes/estrategia/ofertas/x' }],
      },
    ]) {
      expect(CopilotEvent.safeParse(event).success).toBe(true);
    }
    expect(
      CopilotEvent.safeParse({
        type: 'tool_result',
        id: 'c1',
        name: 'list_offers',
        status: 'ok',
        summary: 'x',
        links: [{ label: 'x', href: 'https://fora.example' }],
      }).success,
    ).toBe(false);
  });
});

describe('conversas', () => {
  it('título vem da primeira pergunta, em uma linha e curto', () => {
    expect(threadTitleFrom('  Quais   ofertas\n eu tenho?  ')).toBe('Quais ofertas eu tenho?');
    expect(threadTitleFrom('')).toBe('Conversa sem título');
    const long = threadTitleFrom(
      'Quero entender quais clínicas odontológicas de Ribeirão Preto têm site desatualizado e marca antiga',
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });

  it('renomear exige título com texto e até 120 caracteres', () => {
    expect(RenameThreadInput.parse({ threadId: THREAD, title: '  Ofertas  ' }).title).toBe(
      'Ofertas',
    );
    expect(RenameThreadInput.safeParse({ threadId: THREAD, title: ' ' }).success).toBe(false);
    expect(RenameThreadInput.safeParse({ threadId: THREAD, title: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });
});
