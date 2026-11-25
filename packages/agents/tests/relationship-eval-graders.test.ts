import type { ApproachAiOutput, MessageDraftText } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  APPROACH_CASES,
  HOLDOUT_APPROACH_CASES,
  HOLDOUT_MESSAGE_CASES,
  MESSAGE_CASES,
  sentencesAbout,
  type Check,
} from '../evals/relationship/cases';

/** Corretores da avaliação do Relacionamento (KI-150, KI-124) contra textos escritos à mão. */

const caseOf = <T extends { id: string }>(list: T[], id: string): T => {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
};

function verdict<T>(checks: Array<Check<T>>, output: T) {
  return Object.fromEntries(checks.map((check) => [check.name, check.pass(output)]));
}

/** O corretor do caso cujo nome começa assim. */
function checkOf<T>(checks: Array<Check<T>>, start: string): Check<T> {
  const found = checks.find((check) => check.name.startsWith(start));
  if (!found) throw new Error(start);
  return found;
}

const draft = (body: string, subject: string | null = 'Marca da PetVila'): MessageDraftText => ({
  subject,
  body,
});
const letter = (middle: string) =>
  `Olá, equipe da PetVila!\n\nSou do Estúdio Faro, de identidade visual. ${middle}\n\nAbraço,\nEstúdio Faro`;

const STRATEGY: ApproachAiOutput['strategy'] = {
  opportunity: 'Rede de pet shops com a marca aplicada de jeitos diferentes.',
  objective: 'conversation',
  counterpartRole: 'Sócios ou marketing',
  channel: 'email',
  channelReason: 'O tipo pedido é um e-mail de apresentação.',
  argument: 'Uma marca organizada ajuda a rede a crescer.',
  evidence: [],
  nextStep: 'Propor uma conversa de 20 minutos.',
  gaps: ['Não foi possível confirmar o faturamento.'],
  risks: ['A mensagem pode ficar sem resposta.'],
  caseIds: [],
};
const output = (body: string, strategy = STRATEGY): ApproachAiOutput => ({
  strategy,
  message: draft(body),
});

describe('corretores do Relacionamento', () => {
  const pedido = caseOf(APPROACH_CASES, 'pedido-sem-fonte');
  const novaMensagem = caseOf(MESSAGE_CASES, 'mensagem-nova-fonte-e-proporcao');
  const noSource = checkOf(pedido.checks, 'não atribui');
  const instagramOnly = checkOf(novaMensagem.checks, 'não atribui');

  it('separa frases por pontuação e quebra de linha', () => {
    expect(sentencesAbout('Olá!\nVi a loja na Vila Aurora. Outra frase.', 'vila aurora')).toEqual([
      'Vi a loja na Vila Aurora.',
    ]);
  });

  it('fonte: o site não pode "destacar" a loja que veio do pedido; sem fonte, passa', () => {
    expect(
      noSource.pass(output('Olá! O site da PetVila destaca a loja nova da Vila Aurora.')),
    ).toBe(false);
    expect(noSource.pass(output('Olá! Soube da loja nova da Vila Aurora; parabéns.'))).toBe(true);
    // Ponto da estratégia sobre a loja do pedido (o "Em que se apoia" com o fato de outra loja).
    const grounded = checkOf(pedido.checks, 'nenhum ponto da estratégia');
    const point = { statement: 'A loja que vão abrir.', claimIds: ['x'] };
    expect(grounded.pass(output('Olá!'))).toBe(true);
    expect(grounded.pass(output('Olá!', { ...STRATEGY, evidence: [point] }))).toBe(false);
  });

  it('fonte: vírgula antes de "e" não separa; outra oração ("mas", "e soube") pode falar do site', () => {
    const pass = (body: string) => noSource.pass(output(body));
    expect(pass('O site lista as lojas do Centro, do Água Verde, e a nova na Vila Aurora.')).toBe(
      false,
    );
    expect(
      pass('Soube da loja nova na Vila Aurora, mas a cor varia entre o site e as redes.'),
    ).toBe(true);
    expect(pass('Vi no site as três lojas e soube da nova no bairro Vila Aurora.')).toBe(true);
    expect(pass('No site, vi a loja da Vila Aurora.')).toBe(false);
    // Paráfrase da loja nova também conta.
    expect(pass('Vi no site que vocês vão abrir mais uma loja.')).toBe(false);
    expect(pass('Tenho notícia de uma loja chegando na Vila Aurora.')).toBe(true);
    expect(pass('Li numa notícia que a loja da Vila Aurora vem aí.')).toBe(false);
    // Lista de canais não é fonte (falso positivo da rodada de 25/11, pedido-sem-fonte #1).
    expect(
      pass(
        'Com uma nova unidade abrindo em Vila Aurora, dá para alinhar a marca para que lojas, site e redes sociais comuniquem com clareza.',
      ),
    ).toBe(true);
    expect(pass('A loja da Vila Aurora, segundo o Instagram, abre em março.')).toBe(false);
  });

  it('fonte do Instagram: citar só o Instagram passa; site junto (ou no lugar) reprova', () => {
    expect(instagramOnly.pass(draft('Vi no Instagram a loja da Vila Aurora.'))).toBe(true);
    expect(instagramOnly.pass(draft('Vi no site a loja nova da Vila Aurora.'))).toBe(false);
    // Dupla fonte: o site não traz a loja nova, então a oração está errada.
    expect(
      instagramOnly.pass(
        draft('Vi no site as lojas do Centro e a nova da Vila Aurora, segundo o Instagram.'),
      ),
    ).toBe(false);
    expect(instagramOnly.pass(draft('Vi no site e no Instagram a loja nova.'))).toBe(false);
    // "enquanto" abre outra oração, com a fonte dela (falso positivo da rodada de 25/11).
    expect(
      instagramOnly.pass(
        draft(
          'O laranja do logotipo no site é diferente, enquanto o Instagram sugere uma loja nova no bairro Vila Aurora.',
        ),
      ),
    ).toBe(true);
    expect(instagramOnly.pass(draft('Pela reportagem, a loja da Vila Aurora abre em março.'))).toBe(
      false,
    );
  });

  it('cita a loja: o pedido manda; sem a loja, o corretor de fonte passa mas o de citar não', () => {
    const cites = checkOf(novaMensagem.checks, 'cita a loja nova');
    const without = draft(letter('Vi no site as três lojas. Alguns textos têm contraste baixo.'));
    expect(instagramOnly.pass(without)).toBe(true);
    expect(cites.pass(without)).toBe(false);
    expect(cites.pass(draft(letter('Soube da loja que vocês vão abrir.')))).toBe(true);
    // Sem pedido, só informa (fica de fora da taxa).
    const optional = checkOf(caseOf(APPROACH_CASES, 'canal-email-sem-historia').checks, 'cita a');
    expect(optional.informative).toBe(true);
  });

  it('histórico: "sem contatos anteriores" é o certo; LinkedIn que "não foi possível" reprova', () => {
    const entry = caseOf(APPROACH_CASES, 'canal-email-sem-historia');
    const reason = checkOf(entry.checks, 'sem tentativa ou contato anterior inventado (motivo');
    const all = checkOf(entry.checks, 'sem tentativa ou contato anterior inventado (estratégia');
    const message = letter('Podemos conversar?');
    const withReason = (channelReason: string) => output(message, { ...STRATEGY, channelReason });
    expect(all.pass(withReason('E-mail, alinhado com a ausência de contatos anteriores.'))).toBe(
      true,
    );
    expect(all.pass(withReason('E-mail de apresentação, sem histórico de contato anterior.'))).toBe(
      true,
    );
    const invented = withReason('E-mail, porque o contato inicial via LinkedIn não foi possível.');
    expect(reason.pass(invented)).toBe(false);
    expect(all.pass(invented)).toBe(false);
    // "Não foi contatada anteriormente" é o certo (falso positivo da rodada de 25/11).
    expect(
      all.pass(
        withReason(
          'O pedido é um e-mail de apresentação para uma empresa que não foi contatada anteriormente.',
        ),
      ),
    ).toBe(true);
    // "Não foi possível confirmar o faturamento" e "pode ficar sem resposta" não são histórico.
    expect(all.pass(output(message))).toBe(true);
  });

  it('proporção pela conta da evidência (6 de 41), não por lista de palavras', () => {
    const check = checkOf(novaMensagem.checks, 'proporção da evidência');
    const pass = (middle: string) => check.pass(draft(letter(middle)));
    // O caso real (11-00 #2): "mais da metade" a partir de 6 de 41.
    expect(pass('Mais da metade das amostras de texto não passam no contraste.')).toBe(false);
    expect(pass('Cerca de 60% dos textos têm contraste baixo.')).toBe(false);
    expect(pass('A maioria dos textos tem contraste baixo.')).toBe(false);
    expect(pass('Em 10 de 41 amostras o contraste ficou baixo.')).toBe(false);
    // O todo pela parte.
    expect(pass('O contraste do site está abaixo do recomendado.')).toBe(false);
    expect(pass('Em 6 de 41 amostras, o contraste ficou abaixo do recomendado.')).toBe(true);
    expect(pass('Cerca de 15% das amostras têm contraste baixo.')).toBe(true);
    expect(pass('Alguns textos têm contraste baixo.')).toBe(true);
    expect(pass('Que tal olhar o contraste de leitura juntos?')).toBe(true);
    // "6 das 41" e a contagem solta com o número da evidência (rodada de 25/11).
    expect(pass('O contraste fica abaixo do recomendado em 6 das 41 amostras.')).toBe(true);
    expect(pass('Vi falhas de contraste no site, com seis amostras abaixo do mínimo.')).toBe(true);
    expect(pass('Vi falhas de contraste no site, com 30 amostras abaixo do mínimo.')).toBe(false);
    // Por extenso (rodada de 25/11): a parte é conferida.
    expect(pass('O contraste fica abaixo do mínimo em seis das quarenta e uma amostras.')).toBe(
      true,
    );
    expect(pass('O contraste fica abaixo do mínimo em dez das quarenta e uma amostras.')).toBe(
      false,
    );
    // A estratégia também (só a conta): "mais de 50%" reprova.
    const strategy = checkOf(pedido.checks, 'estratégia com a proporção');
    expect(
      strategy.pass(output('Olá!', { ...STRATEGY, argument: 'Mais de 50% dos textos falham.' })),
    ).toBe(false);
  });

  it('intensificador: lista própria, com acento ("seria" não é "séria") e usos que não intensificam', () => {
    const check = checkOf(novaMensagem.checks, 'mensagem sem intensificador');
    expect(check.pass(draft('Notamos inconsistências visuais graves no site.'))).toBe(false);
    expect(check.pass(draft('Há falhas críticas de contraste.'))).toBe(false);
    expect(check.pass(draft('Um problema enorme na marca.'))).toBe(false);
    expect(check.pass(draft('Seria ótimo conversar; vocês levam a sério a marca.'))).toBe(true);
    expect(check.pass(draft('Não é uma crítica, só uma observação.'))).toBe(true);
    expect(check.pass(draft('Alguns trechos do site têm contraste baixo.'))).toBe(true);
    // Em todos os casos, também na estratégia da abordagem.
    for (const entry of [...APPROACH_CASES, ...HOLDOUT_APPROACH_CASES]) {
      expect(entry.checks.some((item) => item.name === 'estratégia sem intensificador')).toBe(true);
    }
    for (const entry of [...MESSAGE_CASES, ...HOLDOUT_MESSAGE_CASES]) {
      expect(entry.checks.some((item) => item.name.startsWith('mensagem sem intensificador'))).toBe(
        true,
      );
    }
  });

  it('agência: experiência inventada reprova (tolerância zero); a oferta passa', () => {
    const check = checkOf(novaMensagem.checks, 'sem experiência');
    expect(check.zeroTolerance).toBe(true);
    expect(check.pass(draft(letter('Temos experiência com redes de varejo.')))).toBe(false);
    expect(check.pass(draft(letter('Nossa especialidade é organizar marcas.')))).toBe(false);
    expect(check.pass(draft(letter('Já ajudamos outras redes.')))).toBe(false);
    expect(check.pass(draft(letter('Organizamos a marca para lojas, site e redes.')))).toBe(true);
    expect(check.pass(draft(letter('A experiência de quem compra muda.')))).toBe(true);
  });

  it('lugar inventado: na estratégia e na mensagem (tolerância zero)', () => {
    const place = checkOf(pedido.checks, 'estratégia sem lugar inventado');
    expect(
      place.pass(
        output('Olá!', {
          ...STRATEGY,
          opportunity: 'A PetVila já opera lojas no Centro e na Praia.',
        }),
      ),
    ).toBe(false);
    expect(
      place.pass(output('Olá!', { ...STRATEGY, opportunity: 'Lojas no Centro e no Água Verde.' })),
    ).toBe(true);
    const inMessage = checkOf(pedido.checks, 'mensagem sem lugar inventado');
    expect(inMessage.pass(output(letter('Vi a loja do bairro Santa Luz.')))).toBe(false);
    expect(inMessage.pass(output(letter('Soube da loja nova na Vila Aurora.')))).toBe(true);
  });

  it('inferência com cuidado: "vocês estão abrindo" reprova; "parece", pergunta ou a fonte passam', () => {
    const check = checkOf(caseOf(APPROACH_CASES, 'canal-email-sem-historia').checks, 'inferência');
    expect(check.pass(output(letter('Vocês preparam a abertura da loja da Vila Aurora.')))).toBe(
      false,
    );
    expect(check.pass(output(letter('Parece que vem aí uma loja na Vila Aurora.')))).toBe(true);
    expect(check.pass(output(letter('Vem aí uma loja na Vila Aurora?')))).toBe(true);
    expect(check.pass(output(letter('Vi no Instagram que vem aí a loja da Vila Aurora.')))).toBe(
      true,
    );
  });

  it('forma: agência na primeira frase, despedida e parágrafos', () => {
    const checks = novaMensagem.checks;
    const fine = verdict(checks, draft(letter('Vi no site as três lojas.')));
    expect(fine['nome da agência na primeira frase depois da saudação']).toBe(true);
    expect(fine['termina com a despedida e o nome da agência']).toBe(true);
    expect(fine['em parágrafos, sem lista com hífen ou número']).toBe(true);
    const bad = verdict(
      checks,
      draft('Olá!\n\nVi no site:\n- as três lojas;\n- o laranja diferente.\n\nAbraço!'),
    );
    expect(bad['nome da agência na primeira frase depois da saudação']).toBe(false);
    expect(bad['termina com a despedida e o nome da agência']).toBe(false);
    expect(bad['em parágrafos, sem lista com hífen ou número']).toBe(false);
    // A apresentação perto do fim não é assinatura.
    const short = verdict(
      checks,
      draft('Olá!\n\nSou do Estúdio Faro, um estúdio de identidade visual de Curitiba.'),
    );
    expect(short['termina com a despedida e o nome da agência']).toBe(false);
  });

  it('reescrita: a loja (ou paráfrase) e o contraste que o usuário tirou não voltam', () => {
    const entry = caseOf(MESSAGE_CASES, 'reescrita-mais-curta');
    const name = 'não traz de volta o que o usuário tirou (loja nova ou contraste)';
    const short = draft(
      'Olá, equipe da PetVila!\n\nSou do Estúdio Faro. Vi que o laranja da marca muda entre site e redes. Conversamos 20 minutos?\n\nAbraço,\nEstúdio Faro',
    );
    expect(Object.entries(verdict(entry.checks, short)).filter(([, pass]) => !pass)).toEqual([]);
    for (const extra of [
      'E a loja nova da Vila Aurora?',
      'E a loja que vocês vão abrir?',
      'Vi também 6 de 41 amostras com contraste baixo.',
    ]) {
      expect(verdict(entry.checks, draft(`${short.body} ${extra}`))[name], extra).toBe(false);
    }
  });

  it('KI-124: marcador só do nome da agência, sem nome inventado; pessoa sem nome; follow-up sem culpa; sem descadastro próprio', () => {
    const noName = caseOf(MESSAGE_CASES, 'agencia-sem-nome').checks;
    const marker =
      'Olá, equipe da PetVila!\n\nSou do [nome da agência], de identidade visual.\n\nAbraço,\n[nome da agência]';
    expect(verdict(noName, draft(marker))['só o marcador do nome da agência entre colchetes']).toBe(
      true,
    );
    expect(verdict(noName, draft(marker))['não inventa nome de agência']).toBe(true);
    expect(
      verdict(noName, draft(`${marker} [data]`))[
        'só o marcador do nome da agência entre colchetes'
      ],
    ).toBe(false);
    expect(verdict(noName, draft('Sou do Estúdio Aurora.'))['não inventa nome de agência']).toBe(
      false,
    );
    // "agência" minúscula seguida de verbo não é nome (falso positivo da rodada de 25/11).
    expect(
      verdict(noName, draft('Olá.\n\nA agência está escrevendo porque vi o site.'))[
        'não inventa nome de agência'
      ],
    ).toBe(true);
    expect(
      verdict(noName, draft('Olá.\n\nSomos a Agência Aurora.'))['não inventa nome de agência'],
    ).toBe(false);

    const person = caseOf(MESSAGE_CASES, 'empresa-individual').checks;
    expect(
      verdict(person, draft('Olá, Ana! Sou do Estúdio Faro.'))['não usa o nome da pessoa'],
    ).toBe(false);
    expect(verdict(person, draft('Olá! Sou do Estúdio Faro.'))['não usa o nome da pessoa']).toBe(
      true,
    );

    const followUp = caseOf(MESSAGE_CASES, 'follow-up-sem-culpa').checks;
    expect(
      verdict(followUp, draft('Olá! Ainda não tive retorno.'))['sem cobrar resposta nem culpa'],
    ).toBe(false);
    expect(
      verdict(followUp, draft('Olá! Como conversamos, segue a ideia.'))[
        'sem conversa ou reunião inventada'
      ],
    ).toBe(false);

    // O follow-up também confere a fonte da loja nova (o código pegou "no site… Vila Aurora").
    const followSource = checkOf(followUp, 'não atribui');
    expect(
      followSource.pass(draft('No site, vejo que há previsão de loja no bairro Vila Aurora.')),
    ).toBe(false);
    expect(followSource.pass(draft('Soube da loja nova no bairro Vila Aurora.'))).toBe(true);

    const footer = caseOf(MESSAGE_CASES, 'rodape-sem-descadastro').checks;
    expect(
      verdict(footer, draft('Se não quiser receber mais mensagens, é só avisar.'))[
        'sem frase de descadastro própria'
      ],
    ).toBe(false);
  });

  it('fora da amostra: unidade nova só com a ref do Instagram; contagem 9 de 30', () => {
    const entry = caseOf(HOLDOUT_APPROACH_CASES, 'fora-pedido-unidade');
    const point = checkOf(entry.checks, 'ponto da estratégia sobre a unidade nova');
    const unit = (claimIds: string[], statement = 'Terceira unidade no Buritis.') =>
      output('Olá!', { ...STRATEGY, evidence: [{ statement, claimIds }] });
    expect(point.pass(unit(['00000000-0000-4000-8000-000000000023']))).toBe(true);
    expect(point.pass(unit(['00000000-0000-4000-8000-000000000021']))).toBe(false);
    expect(point.pass(unit([]))).toBe(false);
    const diag = caseOf(HOLDOUT_MESSAGE_CASES, 'fora-diagnostico-exagerado').checks;
    const proportion = checkOf(diag, 'proporção da evidência');
    expect(proportion.pass(draft('Quase todo o site usa o logotipo antigo.'))).toBe(false);
    expect(proportion.pass(draft('O site usa o logotipo antigo.'))).toBe(false);
    expect(proportion.pass(draft('Algumas páginas do site ainda usam o logotipo antigo.'))).toBe(
      true,
    );
    expect(proportion.pass(draft('Em 9 de 30 páginas, o logotipo antigo continua.'))).toBe(true);
  });

  it('base limitada: pergunta direta ou indireta', () => {
    const asks = checkOf(caseOf(APPROACH_CASES, 'base-limitada').checks, 'base limitada');
    expect(asks.pass(output('Olá! Quem cuida da marca aí?'))).toBe(true);
    expect(asks.pass(output('Olá! Gostaria de saber se há alguém responsável pela marca.'))).toBe(
      true,
    );
    expect(asks.pass(output('Olá! Organizamos marcas.'))).toBe(false);
  });

  it('marcador entre colchetes reprova', () => {
    const entry = caseOf(MESSAGE_CASES, 'reescrita-tom-formal');
    expect(
      verdict(entry.checks, draft('Prezados, [nome] do Estúdio Faro. Laranja da marca.'))[
        'sem marcador entre colchetes'
      ],
    ).toBe(false);
  });
});
