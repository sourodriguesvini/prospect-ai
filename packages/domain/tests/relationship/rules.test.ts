import { EMPTY_APPROACH_INSIGHTS, type OpportunitySummary } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  approvalProblems,
  assessApproachBasis,
  attentionItems,
  channelIssues,
  contactState,
  detectStopRequest,
  messageIssues,
  messagePayload,
  replyOwnText,
  stageTransition,
  suggestStage,
  withContactFooter,
  withoutContactFooter,
  withOptOut,
} from '../../src';

/** Regras do Relacionamento (ADR-0014). Textos SINTÉTICOS. */

const NOW = new Date('2026-11-11T15:00:00Z');
const DAY_START = new Date('2026-11-11T03:00:00Z');
const DAY_END = new Date('2026-11-12T03:00:00Z');
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('messagePayload', () => {
  it('é canônico: espaços nas pontas e quebras CRLF não mudam o hash', () => {
    const a = messagePayload({ channel: 'email', subject: ' Olá ', body: 'Linha 1\r\nLinha 2 ' });
    const b = messagePayload({ channel: 'email', subject: 'Olá', body: 'Linha 1\nLinha 2' });
    expect(a).toBe(b);
    expect(messagePayload({ channel: 'phone', subject: 'Olá', body: 'Linha 1\nLinha 2' })).not.toBe(
      b,
    );
  });
});

describe('detectStopRequest', () => {
  it.each([
    'Por favor, me tirem da lista.',
    'Quero me descadastrar.',
    'remover',
    'REMOVER',
    'Por favor, remover.',
    'Remover\n\nJoão\nDiretor comercial',
    'Não me envie mais mensagens.',
    'Não quero mais receber e-mails de vocês.',
    'Parem de mandar mensagens, obrigado.',
    'Remova meu e-mail da base.',
    'remover meu e-mail',
    'Não entrem mais em contato.',
    'Não me contatem.',
    'Favor não entrar em contato.',
    'Me tire do mailing de vocês.',
    'Me tirem da base, por favor.',
    'Remova-me da lista.',
    'Excluam meus dados.',
    'Não queremos ser contatados.',
    'Não insistam, por favor.',
    'Por favor, não nos procurem.',
    'Please remove me from your list.',
    'Unsubscribe',
  ])('reconhece "%s"', (text) => {
    expect(detectStopRequest(text).matched).toBe(true);
  });

  it.each([
    'Não temos interesse agora, talvez no ano que vem.',
    'Obrigado, vou remover o rascunho da proposta antiga e te mando a nova.',
    'Podemos conversar na quinta?',
    'Não me ligue agora, estou em reunião; me mande por e-mail.',
    'Por favor, exclua o e-mail anterior, mandei o arquivo errado.',
    'Não consegui entrar em contato com o João ontem.',
    'Pode me tirar uma dúvida sobre o prazo?',
    'Tire-me uma dúvida: o orçamento inclui o site?',
    'Não mande a proposta ainda, quero ver com o sócio.',
    'Vamos parar de usar o logo antigo.',
    'Não me procure por e-mail, prefiro WhatsApp.',
    'Não me envie mais tarde, mande agora.',
  ])('não confunde negativa ou conversa com opt-out: "%s"', (text) => {
    expect(detectStopRequest(text).matched).toBe(false);
  });

  it('ignora a mensagem citada e o nosso próprio rodapé de opt-out', () => {
    const optOutText = 'Se não quiser mais mensagens, responda "remover".';
    const quoted = [
      'Podemos falar na quinta às 10h.',
      '',
      'Em ter., 10 de nov. de 2026 às 09:00, Agência Exemplo <contato@agencia.example> escreveu:',
      '> Olá, aqui é da Agência Exemplo.',
      '> Se não quiser mais mensagens, responda "remover".',
    ].join('\n');
    expect(detectStopRequest(quoted, { optOutText }).matched).toBe(false);
    const pasted = `Ótimo, vamos conversar. ${optOutText}`;
    expect(detectStopRequest(pasted, { optOutText }).matched).toBe(false);
    expect(detectStopRequest(`Remova meu e-mail.\n\n> ${optOutText}`, { optOutText }).matched).toBe(
      true,
    );
  });

  it('replyOwnText guarda só o que a empresa escreveu, com a grafia original', () => {
    const reply = [
      'Podemos falar na quinta.',
      'Abraço,',
      '',
      'Em ter., 10 de nov. de 2026 às 09:00, Agência Exemplo <contato@agencia.example> escreveu:',
      '> Olá, aqui é da Agência Exemplo.',
      '> Responda "remover" para não receber mais mensagens.',
    ].join('\r\n');
    expect(replyOwnText(reply)).toBe('Podemos falar na quinta.\nAbraço,');
    expect(replyOwnText('> só citação\n> nada mais')).toBe('> só citação\n> nada mais');
  });

  it('a palavra entre aspas da política vale sozinha como pedido', () => {
    const optOutText = 'Para não receber mais nada, responda “chega”.';
    expect(detectStopRequest('Chega.', { optOutText }).matched).toBe(true);
    expect(detectStopRequest('Chega.').matched).toBe(false);
  });
});

describe('estado do contato, canais e rodapé', () => {
  const policy = {
    optOutText: 'Responda "remover" para não receber mais mensagens.',
    privacyContact: 'privacidade@agencia.example',
  };
  const first = { firstContact: true, awaitingFirstReply: true, whatsappOptIn: false };
  const followUp = { firstContact: false, awaitingFirstReply: true, whatsappOptIn: false };
  const talking = { firstContact: false, awaitingFirstReply: false, whatsappOptIn: false };
  const base = {
    channel: 'email' as const,
    subject: 'Assunto',
    agencyName: 'Agência Exemplo',
    ...policy,
  };

  it('contactState lê só o que foi registrado', () => {
    expect(contactState([])).toEqual(first);
    expect(contactState([{ direction: 'outbound', channel: 'email' }])).toEqual(followUp);
    expect(
      contactState([
        { direction: 'outbound', channel: 'email' },
        { direction: 'inbound', channel: 'whatsapp_optin' },
      ]),
    ).toEqual({ firstContact: false, awaitingFirstReply: false, whatsappOptIn: true });
    // A empresa escreveu primeiro pelo WhatsApp: ainda é o nosso primeiro contato, mas o canal vale.
    expect(contactState([{ direction: 'inbound', channel: 'whatsapp_optin' }])).toEqual({
      firstContact: true,
      awaitingFirstReply: false,
      whatsappOptIn: true,
    });
  });

  it('primeiro contato só por e-mail ou LinkedIn; WhatsApp só depois que a empresa escreveu por lá', () => {
    expect(channelIssues('email', first)).toEqual([]);
    expect(channelIssues('linkedin_manual', first)).toEqual([]);
    for (const channel of ['phone', 'in_person', 'other', 'whatsapp_optin'] as const) {
      expect(channelIssues(channel, first)).toHaveLength(1);
    }
    expect(channelIssues('whatsapp_optin', followUp)).toHaveLength(1);
    expect(channelIssues('phone', followUp)).toEqual([]);
    expect(channelIssues('whatsapp_optin', { ...talking, whatsappOptIn: true })).toEqual([]);
    expect(channelIssues('whatsapp_optin', { ...first, whatsappOptIn: true })).toEqual([]);
  });

  it('primeiro contato exige identificação, canal do titular, opt-out e assunto; marcador bloqueia', () => {
    const body = withContactFooter('Olá, aqui é da Agência Exemplo.', policy, first);
    expect(body).toContain(policy.optOutText);
    expect(body).toContain(policy.privacyContact);
    expect(messageIssues({ ...base, ...first, body })).toEqual([]);
    expect(
      messageIssues({ ...base, ...first, body: 'Olá, tudo bem? [nome do case]' }).map(
        (i) => i.field,
      ),
    ).toEqual(['body', 'body', 'body', 'body']);
    expect(messageIssues({ ...base, ...first, subject: null, body }).map((i) => i.field)).toEqual([
      'subject',
    ]);
  });

  it('o tipo da mensagem não importa: follow-up sem resposta ainda leva o opt-out', () => {
    const withoutFooter = 'Olá de novo, conseguiu ver a mensagem anterior?';
    expect(messageIssues({ ...base, ...followUp, body: withoutFooter })).toHaveLength(1);
    const body = withContactFooter(withoutFooter, policy, followUp);
    expect(body).toContain(policy.optOutText);
    expect(body).not.toContain(policy.privacyContact);
    expect(messageIssues({ ...base, ...followUp, body })).toEqual([]);
  });

  it('depois que a empresa respondeu, nada é exigido nem acrescentado', () => {
    const body = 'Combinado, quinta às 10h.';
    expect(withContactFooter(body, policy, talking)).toBe(body);
    expect(messageIssues({ ...base, ...talking, subject: null, body })).toEqual([]);
  });

  it('sem política cadastrada, aponta onde cadastrar', () => {
    const issues = messageIssues({
      ...base,
      ...first,
      agencyName: null,
      optOutText: null,
      privacyContact: null,
      body: 'Olá.',
    });
    expect(issues.map((i) => i.message).join(' ')).toContain('Configuração > Conformidade');
  });

  it('withoutContactFooter tira o rodapé acrescentado (para a IA reescrever) e deixa o texto', () => {
    const body = 'Olá, aqui é da Agência Exemplo.';
    expect(withoutContactFooter(withContactFooter(body, policy, first), policy)).toBe(body);
    expect(withoutContactFooter(withContactFooter(body, policy, followUp), policy)).toBe(body);
    expect(withoutContactFooter(body, policy)).toBe(body);
    expect(withoutContactFooter(body, { optOutText: null, privacyContact: null })).toBe(body);
  });

  it('o rodapé não duplica o que já está no texto', () => {
    const once = withContactFooter('Texto.', policy, first);
    expect(withContactFooter(once, policy, first)).toBe(once);
    expect(withOptOut(withOptOut('Texto.', policy.optOutText), policy.optOutText)).toBe(
      withOptOut('Texto.', policy.optOutText),
    );
  });
});

describe('approvalProblems', () => {
  const approval = {
    id: ID(1),
    status: 'approved',
    payloadHash: 'h',
    expiresAt: '2026-12-11T15:00:00Z',
  };
  const message = { status: 'approved', payloadHash: 'h', approvalId: ID(1) };
  const ok = {
    message,
    isLatestVersion: true,
    approval,
    currentHash: 'h',
    suppressed: false,
    complianceReady: true,
    now: NOW,
  };

  it('vazio quando tudo confere', () => {
    expect(approvalProblems(ok)).toEqual([]);
  });

  it('confere versão, revogação, validade, hash, supressão e conformidade no momento do uso', () => {
    expect(approvalProblems({ ...ok, isLatestVersion: false })).toEqual(['edited']);
    expect(approvalProblems({ ...ok, approval: { ...approval, status: 'revoked' } })).toEqual([
      'revoked',
    ]);
    expect(approvalProblems({ ...ok, now: new Date('2026-12-12T00:00:00Z') })).toEqual(['expired']);
    expect(approvalProblems({ ...ok, currentHash: 'outro' })).toEqual(['hash_mismatch']);
    expect(approvalProblems({ ...ok, suppressed: true, complianceReady: false })).toEqual([
      'suppressed',
      'compliance',
    ]);
    expect(approvalProblems({ ...ok, message: { ...message, status: 'draft' } })).toEqual([
      'not_approved',
    ]);
  });
});

describe('assessApproachBasis', () => {
  let seq = 900;
  const claim = (
    domain: string,
    overrides: Partial<{
      validUntil: string;
      epistemicType: 'fact' | 'inference' | 'hypothesis';
      confidence: number | null;
    }> = {},
  ) => ({
    id: ID(seq++),
    domain: domain as never,
    status: 'active' as const,
    validUntil: '2027-01-01T00:00:00Z',
    epistemicType: 'fact' as const,
    confidence: 0.9 as number | null,
    ...overrides,
  });
  /** Diagnóstico SINTÉTICO cujos achados citam `cited` (um achado por claim). */
  const diagnosisCiting = (
    cited: ReturnType<typeof claim>[],
    status: 'complete' | 'partial' = 'complete',
  ) => ({
    id: ID(800),
    status,
    summary: 'Diagnóstico sintético.',
    findings: cited.map((c) => ({ statement: 'Achado sintético.', claimIds: [c.id] })),
    producedAt: '2026-11-01T00:00:00Z',
    promptId: null,
  });
  const assess = (
    claims: ReturnType<typeof claim>[],
    diagnosis: ReturnType<typeof diagnosisCiting> | null = null,
  ) =>
    assessApproachBasis({
      claims,
      insights: { ...EMPTY_APPROACH_INSIGHTS, diagnosis },
      hasDomain: false,
      now: NOW,
    });
  const PARTIAL_GAP = 'Diagnóstico parcial: a investigação terminou com lacunas.';
  const UNGROUNDED_GAP =
    'O diagnóstico não tem fato nem inferência citável em vigor (só hipóteses ou confiança baixa).';

  it('sem fato citável e sem diagnóstico: insuficiente', () => {
    expect(assess([claim('firmographic', { validUntil: '2026-01-01T00:00:00Z' })]).basis).toBe(
      'insufficient',
    );
    expect(
      assess([claim('positioning', { epistemicType: 'hypothesis', confidence: null })]).basis,
    ).toBe('insufficient');
    expect(assess([claim('digital_presence', { confidence: 0.4 })]).basis).toBe('insufficient');
    expect(
      assess([claim('positioning', { epistemicType: 'inference', confidence: 0.7 })]).basis,
    ).toBe('insufficient');
  });

  it('com fato e sem diagnóstico: limitada, com as lacunas', () => {
    const limited = assess([claim('firmographic')]);
    expect(limited.basis).toBe('limited');
    expect(limited.gaps).toContain('Site da empresa não cadastrado.');
    expect(limited.gaps.some((gap) => gap.startsWith('Só há dados de cadastro'))).toBe(true);
    expect(assess([claim('firmographic'), claim('digital_presence')]).basis).toBe('limited');
  });

  it('diagnóstico completo com achado citável: suficiente, mesmo sem fato no dossiê', () => {
    const inference = claim('positioning', { epistemicType: 'inference', confidence: 0.7 });
    const result = assess([inference], diagnosisCiting([inference]));
    expect(result.basis).toBe('sufficient');
    expect(result.gaps).not.toContain(PARTIAL_GAP);
    expect(result.gaps).not.toContain(UNGROUNDED_GAP);
  });

  it('diagnóstico parcial: limitada, com lacuna própria, mesmo com achado citável', () => {
    const fact = claim('digital_presence');
    const result = assess([fact], diagnosisCiting([fact], 'partial'));
    expect(result.basis).toBe('limited');
    expect(result.gaps).toContain(PARTIAL_GAP);
    expect(result.gaps).not.toContain('Diagnóstico de marca ainda não feito para esta empresa.');
  });

  it('diagnóstico sem achado citável não destrava a base insuficiente', () => {
    const hypothesis = claim('visual', { epistemicType: 'hypothesis', confidence: null });
    const weak = claim('positioning', { epistemicType: 'inference', confidence: 0.3 });
    const expired = claim('signal', { validUntil: '2026-01-01T00:00:00Z' });
    // Só hipótese, inferência de confiança baixa, claim vencido ou nenhum achado: segue bloqueado.
    for (const diagnosis of [
      diagnosisCiting([hypothesis]),
      diagnosisCiting([weak]),
      diagnosisCiting([expired]),
      diagnosisCiting([]),
      diagnosisCiting([hypothesis], 'partial'),
    ]) {
      const result = assess([hypothesis, weak, expired], diagnosis);
      expect(result.basis).toBe('insufficient');
      expect(result.gaps).toContain(UNGROUNDED_GAP);
    }
    // Com fato no dossiê, o mesmo diagnóstico só com hipóteses deixa a base limitada, não suficiente.
    const fact = claim('firmographic');
    const limited = assess([fact, hypothesis], diagnosisCiting([hypothesis]));
    expect(limited.basis).toBe('limited');
    expect(limited.gaps).toContain(UNGROUNDED_GAP);
  });

  it('só claims citáveis podem ser citados: hipótese e confiança baixa ficam de fora', () => {
    const fact = claim('firmographic');
    const inference = claim('positioning', { epistemicType: 'inference', confidence: 0.7 });
    const hypothesis = claim('visual', { epistemicType: 'hypothesis', confidence: null });
    const weak = claim('signal', { confidence: 0.3 });
    expect(assess([fact, inference, hypothesis, weak]).usableClaimIds).toEqual([
      fact.id,
      inference.id,
    ]);
  });
});

describe('stageTransition', () => {
  it('distingue mover, encerrar e reabrir', () => {
    expect(stageTransition('contacted', 'meeting').kind).toBe('move');
    expect(stageTransition('meeting', 'lost').kind).toBe('close');
    expect(stageTransition('lost', 'in_conversation').kind).toBe('reopen');
    expect(stageTransition('won', 'won').kind).toBe('none');
  });
});

describe('attentionItems', () => {
  const summary = (overrides: Partial<OpportunitySummary>): OpportunitySummary => ({
    id: ID(10),
    companyId: ID(20),
    offerId: ID(30),
    stage: 'contacted',
    priority: 'medium',
    valueEstimateCents: null,
    valueBasis: null,
    nextAction: null,
    nextActionDueAt: null,
    lostReason: null,
    source: 'company',
    closedAt: null,
    isDemo: false,
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
    companyName: 'Empresa Sintética',
    companyIsDemo: false,
    offerName: null,
    lastInteractionAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    openTasks: 0,
    nextTaskDueAt: null,
    suppressed: false,
    ...overrides,
  });

  const run = (
    opportunities: OpportunitySummary[],
    tasks = [] as Array<{ dueAt: string; opportunityId?: string }>,
  ) =>
    attentionItems({
      opportunities,
      openTasks: tasks.map((task, index) => ({
        id: ID(100 + index),
        opportunityId: task.opportunityId ?? ID(10),
        title: 'Retomar',
        dueAt: task.dueAt,
        status: 'open',
      })),
      draftsByOpportunity: new Map(),
      now: NOW,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });

  it('resposta esperando retorno vem antes de aguardar o prospect; vencido vem primeiro', () => {
    const items = run(
      [
        summary({
          lastInboundAt: '2026-11-10T12:00:00Z',
          lastOutboundAt: '2026-11-09T12:00:00Z',
          lastInteractionAt: '2026-11-10T12:00:00Z',
          openTasks: 1,
        }),
        summary({
          id: ID(11),
          lastOutboundAt: '2026-11-01T12:00:00Z',
          lastInteractionAt: '2026-11-01T12:00:00Z',
        }),
      ],
      [{ dueAt: '2026-11-08T12:00:00Z' }],
    );
    expect(items.map((item) => item.kind)).toEqual([
      'task_overdue',
      'reply_waiting_us',
      'awaiting_their_reply',
      'no_next_step',
    ]);
    expect(items[0]!.detail).toContain('venceu há 3 dias');
  });

  it('sem oferta definida: faltam informações', () => {
    expect(
      run([summary({ offerId: null, nextAction: 'Ligar', openTasks: 1 })]).map((i) => i.kind),
    ).toEqual(['missing_info']);
  });

  it('empresa com supressão não gera cobrança; oportunidade encerrada não aparece', () => {
    expect(run([summary({ suppressed: true, lastOutboundAt: '2026-10-01T12:00:00Z' })])).toEqual(
      [],
    );
    expect(run([summary({ closedAt: '2026-11-05T12:00:00Z', stage: 'lost' })])).toEqual([]);
  });
});

describe('suggestStage', () => {
  const base = { hasOutbound: false, hasInbound: false, lastClassification: null } as const;

  it('sem registros, não sugere nada', () => {
    expect(suggestStage({ ...base, stage: 'approach_ready' })).toBeNull();
  });

  it('segue o que foi registrado: contato feito, depois resposta', () => {
    expect(suggestStage({ ...base, stage: 'approach_ready', hasOutbound: true })?.to).toBe(
      'contacted',
    );
    expect(
      suggestStage({ ...base, stage: 'contacted', hasOutbound: true, hasInbound: true })?.to,
    ).toBe('in_conversation');
  });

  it('a leitura da resposta pode sugerir reunião, proposta ou perda, nunca voltar etapa', () => {
    const replied = { ...base, hasOutbound: true, hasInbound: true };
    expect(
      suggestStage({ ...replied, stage: 'in_conversation', lastClassification: 'meeting_request' })
        ?.to,
    ).toBe('meeting');
    expect(
      suggestStage({ ...replied, stage: 'meeting', lastClassification: 'proposal_request' })?.to,
    ).toBe('proposal');
    expect(
      suggestStage({ ...replied, stage: 'proposal', lastClassification: 'meeting_request' }),
    ).toBeNull();
    expect(suggestStage({ ...replied, stage: 'meeting', lastClassification: 'refusal' })?.to).toBe(
      'lost',
    );
  });

  it('oportunidade encerrada não recebe sugestão', () => {
    expect(
      suggestStage({ ...base, stage: 'won', hasInbound: true, lastClassification: 'refusal' }),
    ).toBeNull();
  });
});
