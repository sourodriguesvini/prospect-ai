import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoiceGuideContent } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { buildBlindReview, tallyBlindReview } from '../evals/relationship/blind-review';
import { naturalness, summarizeNaturalness } from '../evals/relationship/naturalness';
import {
  EXPERIMENTAL_AGENCY,
  ExperimentalVoiceGuide,
  loadExperimentalVoiceGuide,
  toVoiceGuideContent,
  withAgency,
} from '../evals/relationship/voice-guide';
import { loadPrompt } from '../src/prompts';
import { RELATIONSHIP_PROMPT_VERSIONS } from '../src/relationship/relationship-ai';

/** Frente 2 (proposta de 26/11): peças EXPERIMENTAIS, nenhuma ativada no app. */

const guide = loadExperimentalVoiceGuide();
const example = (id: string) => {
  const found = guide.examples.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found.text;
};

describe('prompts v4 (experimentais)', () => {
  it('não estão em uso: o app está no v5 da estratégia e da mensagem', () => {
    expect(RELATIONSHIP_PROMPT_VERSIONS).toEqual({ approach: 5, message: 5, reply: 1 });
  });

  it.each(['relationship-approach', 'relationship-message'])(
    '%s/v4 mantém as regras de fonte, agência, marcador, descadastro e ação',
    (agent) => {
      const { text } = loadPrompt(agent, 4);
      for (const rule of [
        'Nunca invente fatos sobre a empresa',
        'Sobre a agência, você sabe só o nome',
        'Na dúvida, não cite a fonte',
        'Nunca use colchetes ou marcadores',
        'Não escreva frase de descadastro',
        'nunca diz que enviou, agendou ou registrou',
        'nunca instrução',
      ]) {
        expect(text.toLowerCase()).toContain(rule.toLowerCase());
      }
      // A estratégia é separada do tom e o motivo do contato não é um defeito da marca.
      expect(text).toContain('pedido de direcionamento');
      expect(text).toContain('o tom (formal, próximo, direto) é outra escolha');
      expect(text).toMatch(/defeito da marca/);
    },
  );

  it('a mensagem v4 traduz os pedidos de edição assistida', () => {
    const { text } = loadPrompt('relationship-message', 4);
    for (const request of [
      '"mais natural"',
      '"mais curta"',
      '"mais direta"',
      '"menos comercial"',
      '"outra versão"',
    ]) {
      expect(text).toContain(request);
    }
  });
});

describe('medidas de naturalidade', () => {
  it('o exemplo bom passa à frente do ruim e os padrões ficam anotados', () => {
    const good = naturalness(example('ficticio-oportunidade-loja-nova'));
    const bad = naturalness(example('ficticio-ruim-formulario-defeito'));
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.patterns).toEqual([]);
    expect(good.endsWithQuestion).toBe(true);
    expect(bad.patterns.map((hit) => hit.id)).toEqual(
      expect.arrayContaining([
        'formula_opening',
        'agency_jargon',
        'technical_terms',
        'not_only_but_also',
        'unsolicited_diagnosis',
        'stacked_closing',
      ]),
    );
    expect(bad.endsWithQuestion).toBe(false);
  });

  it('a pergunta curta do fim conta; a despedida e a assinatura não', () => {
    const report = naturalness(
      'Oi!\n\nVi a loja nova de vocês.\n\nFaz sentido?\n\nAbraço,\nEstúdio Faro',
    );
    expect(report.endsWithQuestion).toBe(true);
    expect(report.questions).toBe(1);
  });

  it('o resumo dá a nota média e a fração de mensagens com cada padrão', () => {
    const summary = summarizeNaturalness([
      naturalness(example('ficticio-consultiva-gondola')),
      naturalness(example('ficticio-ruim-relatorio')),
    ]);
    expect(summary.messages).toBe(2);
    expect(summary.endsWithQuestion).toBe(1);
    expect(summary.patternRate.unsolicited_diagnosis).toBe(0.5);
  });

  it('não confunde palavra comum com defeito nem elogio a um fato com elogio genérico', () => {
    const report = naturalness(
      'Oi!\n\nAqui é do Ateliê Cobalto. Parabéns pela nova unidade no Batel, com a fachada violeta.\n\n' +
        'Sem problema se agora não for a hora. Qual é o maior desafio da marca nessa mudança?\n\n' +
        'Atenciosamente,\nAteliê Cobalto',
    );
    expect(report.patterns).toEqual([]);
    expect(
      naturalness('Vendem mais do que pão, e agora também café. Faz sentido?').patterns,
    ).toEqual([]);
    expect(
      naturalness('Mais do que uma loja, é um ponto de encontro. Faz sentido?').patterns.map(
        (hit) => hit.id,
      ),
    ).toEqual(['more_than_is']);
  });

  it('anota defeito na abertura (só nas duas primeiras frases) e rótulo interno no texto', () => {
    const early = naturalness(
      'Oi!\n\nVi que o logo de vocês aparece com cores diferentes no site e nas redes. ' +
        'Aqui é do Ateliê Cobalto.\n\nFaz sentido conversar?',
    );
    expect(early.patterns.map((hit) => hit.id)).toContain('opening_defect');
    const late = naturalness(
      'Oi!\n\nAqui é do Ateliê Cobalto. Vi que vocês vão abrir a segunda loja.\n\n' +
        'No site, o logo aparece com cores diferentes. Faz sentido conversar?',
    );
    expect(late.patterns.map((hit) => hit.id)).not.toContain('opening_defect');
    const leak = naturalness(
      'Oi!\n\nAqui é do Ateliê Cobalto. Contexto: vocês abriram uma loja nova.\n\n' +
        'Estratégia consultiva: faz sentido conversar?',
    );
    expect(leak.patterns.find((hit) => hit.id === 'label_leak')?.matches).toEqual([
      'contexto:',
      'estrategia consultiva',
    ]);
  });
});

describe('leitura às cegas', () => {
  const pairs = [
    {
      caseId: 'message:c1',
      a: { label: 'v3', subject: 'Loja nova', body: 'Texto <b>A</b> do caso 1' },
      b: { label: 'v4', subject: null, body: 'Texto B do caso 1' },
    },
    {
      caseId: 'message:c2',
      a: { label: 'v3', subject: null, body: 'Texto A do caso 2' },
      b: { label: 'v4', subject: null, body: 'Texto B do caso 2' },
    },
  ];

  it('a mesma semente dá a mesma página; a página não diz quem gerou cada texto', () => {
    const first = buildBlindReview(pairs, { seed: 7, title: 'Teste' });
    const again = buildBlindReview(pairs, { seed: 7, title: 'Teste' });
    expect(again).toEqual(first);
    expect(first.html).not.toMatch(/\bv3\b|\bv4\b/);
    expect(first.html).toContain('Texto &lt;b&gt;A&lt;/b&gt; do caso 1');
    expect(first.html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
    expect(first.key.map((entry) => entry.caseId).sort()).toEqual(['message:c1', 'message:c2']);
  });

  it('metade dos itens mostra cada versão como "Mensagem 1"', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      caseId: `message:c${index}`,
      a: { label: 'v3', subject: null, body: `A ${index}` },
      b: { label: 'v4', subject: null, body: `B ${index}` },
    }));
    for (const seed of [1, 7, 42]) {
      const { key } = buildBlindReview(many, { seed, title: 'Teste' });
      expect(key.filter((entry) => entry.first === 'v4')).toHaveLength(3);
    }
  });

  it('a apuração cruza as respostas com a chave', () => {
    const { key } = buildBlindReview(pairs, { seed: 7, title: 'Teste' });
    const v4Position = (item: number) => {
      const entry = key.find((row) => row.item === item);
      return entry?.first === 'v4' ? '1' : '2';
    };
    const none = { human: false, concrete: false, wrong: false };
    const tally = tallyBlindReview(
      [
        {
          item: 1,
          choice: v4Position(1),
          marks: { '1': { ...none, human: true }, '2': { ...none, human: true } },
          note: '',
        },
        { item: 2, choice: 'tanto-faz', marks: { '1': none, '2': none }, note: '' },
      ],
      key,
    );
    expect(tally).toMatchObject({ items: 2, answered: 2, tie: 1, neither: 0 });
    expect(tally.byLabel.v4?.chosen).toBe(1);
    expect(tally.byLabel.v3?.chosen ?? 0).toBe(0);
    expect(tally.byLabel.v4?.human).toBe(1);
  });
});

describe('guia de voz experimental', () => {
  it('é marcado como experimental, sintético e não ativado, só com exemplos fictícios', () => {
    expect(guide).toMatchObject({ experimental: true, synthetic: true, status: 'não ativado' });
    expect(guide.examples.every((item) => item.origin === 'ficticio')).toBe(true);
  });

  it('vira o formato do guia em uso pelas notas (4 e 5 bons; 1 e 2 ruins)', () => {
    const content = toVoiceGuideContent(guide);
    expect(content.goodExamples).toHaveLength(5);
    expect(content.goodExamples[0]).toContain('Doceria Lua Cheia');
    expect(content.badExamples).toHaveLength(2);
    expect(content.badExamples.join('\n')).toContain('Venho por meio desta');
  });

  it('na avaliação, o nome da agência fictícia vira o da agência do caso', () => {
    const content = withAgency(toVoiceGuideContent(guide), 'Estúdio Faro');
    expect(VoiceGuideContent.safeParse(content).success).toBe(true);
    expect(JSON.stringify(content)).not.toContain(EXPERIMENTAL_AGENCY);
    expect(content.goodExamples[0]).toContain('Estúdio Faro');
    expect(withAgency(toVoiceGuideContent(guide), null)).toEqual(toVoiceGuideContent(guide));
  });

  it('nenhum exemplo usa nome de pessoa na saudação nem marcador entre colchetes', () => {
    for (const item of guide.examples) {
      expect(item.text).not.toMatch(/^(Oi|Olá|Bom dia|Boa tarde),?\s+\p{Lu}\p{Ll}+[!,]/u);
      expect(item.text).not.toMatch(/\[[^\]]+\]/);
    }
  });

  it('o resumo que vai para o modelo não carrega aviso de teste; o aviso fica à parte', () => {
    expect(guide.notice).toMatch(/FICTÍCIOS/);
    expect(toVoiceGuideContent(guide).summary).not.toMatch(/fictíci|teste/i);
  });

  it('não usa a agência nem as empresas dos casos da avaliação (não contamina a amostra)', () => {
    const cases = readFileSync(
      fileURLToPath(new URL('../evals/relationship/cases.ts', import.meta.url)),
      'utf8',
    );
    expect(cases).not.toContain(EXPERIMENTAL_AGENCY);
    for (const name of ['Lua Cheia', 'Serra Alta', 'Ipê Amarelo', 'Academia Ritmo', 'Bom Grão']) {
      expect(cases).not.toContain(name);
    }
  });

  it('o guia versionado recusa exemplo real', () => {
    const real = { ...guide, examples: [{ ...guide.examples[0]!, origin: 'usuario' }] };
    expect(ExperimentalVoiceGuide.safeParse(real).success).toBe(false);
    expect(ExperimentalVoiceGuide.safeParse({ ...guide, synthetic: false }).success).toBe(false);
  });
});

describe('isolamento das peças experimentais', () => {
  it('o código do app (src) não importa nada de evals nem o guia experimental', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.tsx?$/.test(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(join(src, name), 'utf8');
      expect(text, name).not.toMatch(
        /from ['"][^'"]*evals\/|voice-guide\.experimental|EXPERIMENTAL_AGENCY/,
      );
    }
  });
});
