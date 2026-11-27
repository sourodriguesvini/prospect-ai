import type { ResearchCriteria } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  creditCapFor,
  extractCandidates,
  interpretResearchRequest,
  interpretResearchRevision,
  locationIn,
  nextBatch,
  orderedUfs,
  personNameIn,
  planResearch,
  regionsWithout,
  replanResearch,
  researchBreakdown,
  ufsInText,
  UF_INFO,
} from '../../src';

const BLUMMY_REQUEST =
  'Quero encontrar 100 terapeutas ocupacionais no Brasil para apresentar a Blummy.';

function criteria(overrides: Partial<ResearchCriteria> = {}): ResearchCriteria {
  return {
    profession: 'terapeuta ocupacional',
    terms: ['terapeuta ocupacional', 'terapia ocupacional', 'clínica de terapia ocupacional'],
    entityKinds: ['person', 'organization'],
    ufs: [],
    priorityUfs: [],
    cities: [],
    assumptions: [],
    ...overrides,
  };
}

describe('pedido de pesquisa extensa (Parte 6.5)', () => {
  it('o pedido da Blummy vira pesquisa nacional de 100, com perfil, objetivo e premissas', () => {
    const result = interpretResearchRequest(BLUMMY_REQUEST);
    expect(result).toMatchObject({
      profileId: 'blummy',
      profileReason: 'named',
      requestedCount: 100,
      objective: 'Apresentar a Blummy',
      audience: 'terapeutas ocupacionais',
      criteria: {
        profession: 'terapeuta ocupacional',
        entityKinds: ['person', 'organization'],
        ufs: [],
        priorityUfs: [],
      },
    });
    expect(result?.criteria.assumptions.join(' ')).toMatch(/Brasil inteiro/);
    expect(result?.criteria.assumptions.join(' ')).toMatch(/usuário, comprador ou influenciador/);
  });

  it('sem quantidade, 50 com premissa; acima de 500, 500; região pelo nome ou pela sigla', () => {
    const noCount = interpretResearchRequest('Encontre fonoaudiólogos em Minas Gerais e no PR');
    expect(noCount?.requestedCount).toBe(50);
    expect(noCount?.criteria.ufs).toEqual(['MG', 'PR']);
    expect(noCount?.criteria.assumptions[0]).toMatch(/50 resultados/);
    expect(interpretResearchRequest('Liste 900 psicólogos em SP')?.requestedCount).toBe(500);
    const city = interpretResearchRequest('Busque 20 fisioterapeutas em Campinas');
    expect(city?.criteria).toMatchObject({ ufs: ['SP'], cities: ['Campinas'] });
  });

  it('pergunta comum ou pedido sobre empresa não é pesquisa extensa', () => {
    expect(interpretResearchRequest('O que é terapia ocupacional?')).toBeNull();
    expect(
      interpretResearchRequest('Pesquise a empresa Flash e me diga o momento dela'),
    ).toBeNull();
    expect(interpretResearchRequest('Quantas ofertas ativas eu tenho?')).toBeNull();
    // Pedido de texto ou ideia não vira pesquisa (revisão de arquitetura, D4).
    expect(
      interpretResearchRequest('Quero uma mensagem para a psicóloga Pessoa Sintética'),
    ).toBeNull();
    expect(interpretResearchRequest('Me dê ideias de abordagem para nutricionistas')).toBeNull();
    expect(
      interpretResearchRequest('quero 3 exemplos de mensagem para terapeutas ocupacionais'),
    ).toBeNull();
    expect(interpretResearchRequest('Acho que psicólogos gostam disso')).toBeNull();
    expect(
      interpretResearchRequest('quero 100 terapeutas ocupacionais no Brasil')?.requestedCount,
    ).toBe(100);
  });

  it('"TO" é terapia ocupacional, não Tocantins', () => {
    expect(ufsInText('profissionais de TO em SP')).toEqual(['SP']);
    expect(ufsInText('Tocantins e Goiás')).toEqual(['TO', 'GO']);
  });
});

describe('mudança na pesquisa em andamento (Parte 6.3)', () => {
  it('"agora priorize São Paulo e Minas Gerais" muda a prioridade, sem reiniciar', () => {
    expect(
      interpretResearchRevision('Agora priorize São Paulo e Minas Gerais.', {
        requestedCount: 100,
      }),
    ).toMatchObject({ priorityUfs: ['SP', 'MG'] });
    expect(interpretResearchRevision('só no Paraná', { requestedCount: 100 })).toMatchObject({
      ufs: ['PR'],
    });
    expect(interpretResearchRevision('mais 50', { requestedCount: 100 })).toMatchObject({
      requestedCount: 150,
    });
    // Número que conta outra coisa, ou negação, não muda a pesquisa (KI-226).
    const to = { requestedCount: 100, terms: ['terapeutas ocupacionais', 'terapeuta ocupacional'] };
    expect(interpretResearchRevision('quero 3 exemplos de mensagem', to)).toBeNull();
    expect(interpretResearchRevision('me dê mais 2 sugestões de abordagem', to)).toBeNull();
    expect(interpretResearchRevision('não pare a pesquisa, só me explique', to)).toBeNull();
    expect(interpretResearchRevision('mais 50 terapeutas', to)).toMatchObject({
      requestedCount: 150,
    });
    expect(interpretResearchRevision('quero 120 no total', to)).toMatchObject({
      requestedCount: 120,
    });
    // Região e quantidade no mesmo pedido: as duas valem.
    expect(
      interpretResearchRevision('mais 6, agora priorize o PR', { requestedCount: 12 }),
    ).toMatchObject({ requestedCount: 18, priorityUfs: ['PR'] });
    expect(
      interpretResearchRevision('pode parar a pesquisa', { requestedCount: 100 }),
    ).toMatchObject({ cancel: true });
    expect(interpretResearchRevision('continue a pesquisa', { requestedCount: 100 })).toMatchObject(
      {
        resume: true,
      },
    );
    expect(interpretResearchRevision('obrigado!', { requestedCount: 100 })).toBeNull();
    expect(
      interpretResearchRevision('o que continua faltando?', { requestedCount: 100 }),
    ).toBeNull();
    expect(
      interpretResearchRevision('Continue explicando o plano', { requestedCount: 100 }),
    ).toBeNull();
    expect(interpretResearchRevision('pode continuar', { requestedCount: 100 })).toMatchObject({
      resume: true,
    });
  });
});

describe('plano de buscas (Parte 6.4)', () => {
  it('Brasil inteiro: capitais na ordem de população, depois outras cidades, dentro do teto', () => {
    const cap = creditCapFor(100, null);
    expect(cap).toBeGreaterThanOrEqual(50);
    const plan = planResearch(criteria(), cap);
    expect(plan).toHaveLength(cap);
    expect(plan.slice(0, 3).map((query) => query.query)).toEqual([
      'terapeuta ocupacional São Paulo SP',
      'terapeuta ocupacional Belo Horizonte MG',
      'terapeuta ocupacional Rio de Janeiro RJ',
    ]);
    expect(plan[27]?.query).toBe('terapeuta ocupacional Campinas SP');
    // Nenhuma consulta pelo nome de uma pessoa: só termo e lugar.
    expect(plan.every((query) => query.query.startsWith('terapeuta ocupacional'))).toBe(true);
    expect(new Set(plan.map((query) => query.index)).size).toBe(plan.length);
    // O orçamento do mês limita o teto.
    expect(creditCapFor(100, 12)).toBe(12);
  });

  it('priorizar SP e MG depois de rodar: o que rodou fica, o pendente é refeito na ordem nova', () => {
    const first = planResearch(criteria(), 40).map((query, index) =>
      index < 5 ? { ...query, status: 'done' as const, results: 10, added: 3 } : query,
    );
    const revised = criteria({ priorityUfs: ['MG', 'SP'] });
    expect(orderedUfs(revised).slice(0, 3)).toEqual(['MG', 'SP', 'RJ']);
    const plan = replanResearch(first, revised, 40);
    expect(plan.slice(0, 5)).toEqual(first.slice(0, 5));
    const pending = nextBatch(plan, 3).map((query) => query.query);
    // As capitais de MG e SP já rodaram: entram as outras cidades desses estados primeiro.
    expect(pending[0]).toMatch(/ (MG|SP)$/);
    expect(plan).toHaveLength(40);
    expect(new Set(plan.map((query) => query.index)).size).toBe(40);
    expect(new Set(plan.map((query) => query.query)).size).toBe(40);
  });

  it('só um estado: as consultas pendentes de fora somem', () => {
    const first = planResearch(criteria(), 20);
    const plan = replanResearch(first, criteria({ ufs: ['PR'], priorityUfs: ['PR'] }), 20);
    expect(plan.every((query) => query.uf === 'PR')).toBe(true);
  });
});

describe('extração literal dos resultados (Parte 6.5)', () => {
  const query = { index: 3, uf: 'SP' as const, city: 'São Paulo' };

  it('pessoa num diretório: nome do título, local escrito, trecho com o nome, sem telefone', () => {
    const { candidates } = extractCandidates(
      {
        url: 'https://www.doctoralia.com.br/pessoa-sintetica/terapeuta-ocupacional/campinas',
        title: 'Pessoa Sintética de Souza - Terapeuta Ocupacional - Campinas - SP',
        snippet:
          'Pessoa Sintética de Souza atende em Campinas - SP. Agende pelo (19) 99999-0000 ou contato@gmail.com.',
        query,
      },
      criteria(),
      'Blummy',
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'person',
      name: 'Pessoa Sintética de Souza',
      city: 'Campinas',
      uf: 'SP',
      locationBasis: 'quote',
      sourceKind: 'professional_directory',
      segment: 'independent_professional',
      audienceRole: 'user',
      email: null,
      phone: null,
      personalChannelDropped: true,
    });
    expect(candidates[0]!.sourceQuote).toContain('Pessoa Sintética de Souza');
    expect(candidates[0]!.sourceQuote.length).toBeLessThanOrEqual(300);
    expect(candidates[0]!.fitReason).toMatch(/orçamento a confirmar/);
  });

  it('clínica: organização com site próprio, telefone e e-mail públicos, papel de comprador', () => {
    const { candidates } = extractCandidates(
      {
        url: 'https://clinicasintetica.test/sobre',
        title: 'Clínica Sintética de Terapia Ocupacional | Belo Horizonte/MG',
        snippet:
          'Atendimento em terapia ocupacional infantil. Fale conosco: (31) 3333-4444, contato@clinicasintetica.test',
        query: { index: 1, uf: 'MG', city: 'Belo Horizonte' },
      },
      criteria(),
      'Blummy',
    );
    expect(candidates).toEqual([
      expect.objectContaining({
        kind: 'organization',
        name: 'Clínica Sintética de Terapia Ocupacional',
        uf: 'MG',
        website: 'https://clinicasintetica.test',
        email: 'contato@clinicasintetica.test',
        phone: '31 3333-4444',
        segment: 'clinic',
        audienceRole: 'buyer',
      }),
    ]);
  });

  it('rede social, lista de "melhores" e resultado sem a profissão ficam de fora', () => {
    const base = { snippet: 'terapeuta ocupacional', query };
    expect(
      extractCandidates(
        { ...base, url: 'https://www.linkedin.com/in/x', title: 'Pessoa Sintética - TO' },
        criteria(),
        'Blummy',
      ).discarded,
    ).toBe('restricted_host');
    expect(
      extractCandidates(
        {
          ...base,
          url: 'https://www.doctoralia.com.br/terapeuta-ocupacional/sao-paulo',
          title: 'Os 10 melhores Terapeutas Ocupacionais em São Paulo - Doctoralia',
        },
        criteria(),
        'Blummy',
      ).discarded,
    ).toBe('listing');
    expect(
      extractCandidates(
        {
          url: 'https://exemplo.test',
          title: 'Pessoa Sintética - Dentista',
          snippet: 'dentista',
          query,
        },
        criteria(),
        'Blummy',
      ).discarded,
    ).toBe('no_profession');
  });

  it('gestora de clínica é compradora; local sem trecho fica com a região da busca', () => {
    const { candidates } = extractCandidates(
      {
        url: 'https://exemplo.test/equipe',
        title: 'Pessoa Sintética Lima - Coordenadora de Terapia Ocupacional',
        snippet: 'Pessoa Sintética Lima, coordenadora da equipe de terapia ocupacional.',
        query,
      },
      criteria(),
      'Blummy',
    );
    expect(candidates[0]).toMatchObject({
      segment: 'manager',
      audienceRole: 'buyer',
      roleTitle: 'Coordenadora',
      uf: 'SP',
      locationBasis: 'query',
    });
  });

  it('conformidade (revisão de 26/11): canal pessoal fora do trecho e da organização', () => {
    // O trecho guardado prova de onde veio o nome, sem telefone nem e-mail dentro (D1).
    const person = extractCandidates(
      {
        url: 'https://www.doctoralia.com.br/pessoa-sintetica/terapeuta-ocupacional/campinas',
        title: 'Pessoa Sintética de Souza - Terapeuta Ocupacional - Campinas - SP',
        snippet:
          'Pessoa Sintética de Souza atende em Campinas - SP. Agende pelo (19) 99999-0000 ou contato@gmail.com.',
        query,
      },
      criteria(),
      'Blummy',
    ).candidates[0]!;
    expect(person.sourceQuote).not.toMatch(/9999|@/);
    expect(person.identityVariants).toEqual(['pessoa sintetica de souza||terapeuta ocupacional']);
    // Pessoa e clínica no mesmo resultado: o contato fica fora da organização (B1).
    const both = extractCandidates(
      {
        url: 'https://clinicasintetica.test/equipe',
        title: 'Pessoa Sintética Lima - Clínica Sintética de Terapia Ocupacional',
        snippet: 'Fale com a equipe: (31) 3333-4444, contato@clinicasintetica.test',
        query,
      },
      criteria(),
      'Blummy',
    ).candidates;
    expect(both.find((item) => item.kind === 'organization')).toMatchObject({
      email: null,
      phone: null,
    });
    // Organização sozinha: caixa gratuita e celular são canal pessoal.
    const alone = extractCandidates(
      {
        url: 'https://clinicasintetica.test/',
        title: 'Clínica Sintética de Terapia Ocupacional',
        snippet: 'Terapia ocupacional. Contato: (31) 98888-7777, clinica.sintetica@gmail.com',
        query,
      },
      criteria(),
      'Blummy',
    ).candidates[0]!;
    expect(alone).toMatchObject({ kind: 'organization', email: null, phone: null });
    expect(alone.personalChannelDropped).toBe(true);
    // Consultório com nome de pessoa é a pessoa, não uma organização.
    const practice = extractCandidates(
      {
        url: 'https://consultoriosintetico.test/',
        title: 'Consultório Dra. Pessoa Sintética - Terapia Ocupacional',
        snippet: 'Terapia ocupacional infantil no Consultório Dra. Pessoa Sintética.',
        query,
      },
      criteria(),
      'Blummy',
    ).candidates;
    expect(practice.map((item) => item.kind)).toEqual(['person']);
    expect(practice[0]?.name).toBe('Pessoa Sintética');
  });

  it('conformidade: cargo só com palavra inteira, "TO" não é UF, agregadores e portais fora', () => {
    const social = extractCandidates(
      {
        url: 'https://exemplo.test/perfil',
        title: 'Pessoa Sintética Rocha - TO',
        snippet:
          'Pessoa Sintética Rocha, terapeuta ocupacional: habilidades sociais, diretório de recursos.',
        query: { index: 1, uf: null, city: null },
      },
      criteria(),
      'Blummy',
    ).candidates[0]!;
    expect(social).toMatchObject({
      segment: 'independent_professional',
      roleTitle: null,
      uf: null,
    });
    expect(
      extractCandidates(
        {
          url: 'https://www.escavador.com/sobre/1/pessoa-sintetica',
          title: 'Pessoa Sintética - Terapeuta Ocupacional',
          snippet: 'terapeuta ocupacional',
          query,
        },
        criteria(),
        'Blummy',
      ).discarded,
    ).toBe('restricted_host');
    const portal = extractCandidates(
      {
        url: 'https://www.guiamais.com.br/campinas/clinica-sintetica',
        title: 'Clínica Sintética de Terapia Ocupacional - Campinas - SP',
        snippet: 'Clínica de terapia ocupacional em Campinas.',
        query,
      },
      criteria(),
      'Blummy',
    ).candidates[0];
    expect(portal?.website).toBeNull();
    expect(locationIn('Dra. Pessoa Sintética - SP', ['Pessoa Sintética'])).toEqual({
      city: null,
      uf: 'SP',
    });
  });

  it('nomes: aceita "Dra. Nome Sobrenome", recusa termos do título', () => {
    expect(personNameIn('Dra. Pessoa Sintética')).toBe('Pessoa Sintética');
    expect(personNameIn('Terapia Ocupacional Infantil')).toBeNull();
    expect(personNameIn('Agende sua Consulta')).toBeNull();
    expect(locationIn('Atende em Ribeirão Preto/SP')).toEqual({ city: 'Ribeirão Preto', uf: 'SP' });
  });
});

describe('Caso 2 da Parte 8 — Blummy, terapeutas ocupacionais no Brasil (dados SINTÉTICOS)', () => {
  it('produto certo, pesquisa nacional, distribuição regional, quantidade real, fontes e segmentação', () => {
    // Produto correto e pesquisa nacional.
    const request = interpretResearchRequest(BLUMMY_REQUEST)!;
    expect(request.profileId).toBe('blummy');
    expect(request.criteria.ufs).toEqual([]);
    const plan = planResearch(request.criteria, creditCapFor(request.requestedCount, null));
    // As 27 capitais vêm antes de qualquer outra cidade: todas as regiões entram na primeira volta.
    expect(new Set(plan.slice(0, 27).map((item) => item.uf)).size).toBe(27);
    expect(new Set(plan.map((item) => item.uf)).size).toBe(UF_INFO.length);

    // Achados de regiões diferentes, cada um com a fonte e o trecho; a lista de "melhores" sai.
    const results = [
      {
        url: 'https://www.doctoralia.com.br/pessoa-sintetica-um/terapeuta-ocupacional/campinas',
        title: 'Pessoa Sintética Um - Terapeuta Ocupacional - Campinas - SP',
        snippet: 'Pessoa Sintética Um atende em Campinas - SP, terapia ocupacional infantil.',
        query: { index: 27, uf: 'SP' as const, city: 'Campinas' },
      },
      {
        url: 'https://clinicasintetica-recife.test/sobre',
        title: 'Clínica Sintética de Terapia Ocupacional | Recife/PE',
        snippet:
          'Terapia ocupacional para crianças. Fale conosco: contato@clinicasintetica-recife.test',
        query: { index: 7, uf: 'PE' as const, city: 'Recife' },
      },
      {
        url: 'https://www.doctoralia.com.br/pessoa-sintetica-dois/terapeuta-ocupacional/curitiba',
        title: 'Pessoa Sintética Dois - Terapeuta Ocupacional - Curitiba - PR',
        snippet: 'Pessoa Sintética Dois atende em Curitiba - PR.',
        query: { index: 5, uf: 'PR' as const, city: 'Curitiba' },
      },
      {
        url: 'https://exemplo-manaus.test/equipe',
        title: 'Pessoa Sintética Três - Coordenadora de Terapia Ocupacional',
        snippet: 'Pessoa Sintética Três, coordenadora da equipe de terapia ocupacional.',
        query: { index: 13, uf: 'AM' as const, city: 'Manaus' },
      },
      {
        url: 'https://www.doctoralia.com.br/terapeuta-ocupacional/sao-paulo',
        title: 'Os 10 melhores Terapeutas Ocupacionais em São Paulo - Doctoralia',
        snippet: 'terapeuta ocupacional',
        query: { index: 0, uf: 'SP' as const, city: 'São Paulo' },
      },
    ];
    const outcomes = results.map((result) => extractCandidates(result, request.criteria, 'Blummy'));
    expect(outcomes[4]?.discarded).toBe('listing');
    const candidates = outcomes.flatMap((outcome) => outcome.candidates);
    expect(candidates).toHaveLength(4);
    for (const candidate of candidates) {
      // Fonte pública e trecho literal com o nome; nada de canal pessoal.
      expect(candidate.sourceQuote.length).toBeGreaterThan(0);
      expect(candidate.sourceQuote.length).toBeLessThanOrEqual(300);
      expect(candidate.email ?? '').not.toMatch(/gmail|hotmail|outlook/);
    }

    const breakdown = researchBreakdown(
      candidates.map((candidate) => ({ ...candidate, optedOut: false })),
    );
    // Quantidade real: o que foi achado, nunca o pedido.
    expect(breakdown.total).toBe(4);
    expect(breakdown.total).toBeLessThan(request.requestedCount);
    expect(breakdown.regions.map((item) => [item.label, item.count])).toEqual([
      ['Norte', 1],
      ['Nordeste', 1],
      ['Sudeste', 1],
      ['Sul', 1],
    ]);
    expect(regionsWithout(breakdown)).toEqual(['Centro-Oeste']);
    // Pesquisa restrita (revisão de UX de 27/11): só as regiões dos estados pedidos entram.
    expect(regionsWithout(breakdown, ['PR', 'GO'])).toEqual(['Centro-Oeste']);
    expect(regionsWithout(breakdown, ['PR'])).toEqual([]);
    // O estado de Manaus veio só da busca: a tela pede para conferir.
    expect(breakdown.locationFromQueryOnly).toBe(1);
    // Segmentação e papel para o perfil (usa, compra).
    expect(breakdown.segments.map((item) => item.segment).sort()).toEqual([
      'clinic',
      'independent_professional',
      'manager',
    ]);
    expect(Object.fromEntries(breakdown.roles.map((item) => [item.role, item.count]))).toEqual({
      user: 2,
      buyer: 2,
    });
  });

  it('quem pediu opt-out sai da contagem', () => {
    const breakdown = researchBreakdown([
      {
        kind: 'person',
        uf: 'SP',
        segment: 'independent_professional',
        audienceRole: 'user',
        locationBasis: 'quote',
        optedOut: true,
      },
      {
        kind: 'organization',
        uf: null,
        segment: 'clinic',
        audienceRole: 'buyer',
        locationBasis: 'none',
        optedOut: false,
      },
    ]);
    expect(breakdown).toMatchObject({ total: 1, people: 0, organizations: 1 });
    expect(breakdown.regions).toEqual([
      { region: null, label: 'Sem estado conferido', count: 1, ufs: [] },
    ]);
  });
});
