import { describe, expect, it } from 'vitest';
import { expansionEventIn } from '../../src/discovery/signals';

describe('expansionEventIn (KI-148)', () => {
  it('frase institucional de página de loja não é expansão', () => {
    expect(expansionEventIn('mais uma unidade do maior pet shop do Brasil')).toBe(false);
    expect(
      expansionEventIn('Mais uma unidade da maior rede pet do Sul, aberta todos os dias'),
    ).toBe(false);
    expect(expansionEventIn('A maior rede de clínicas do Paraná, presente em 20 cidades')).toBe(
      false,
    );
    expect(expansionEventIn('Atendimento de segunda a sábado, das 8h às 20h')).toBe(false);
  });

  it('acontecimento de expansão passa', () => {
    expect(expansionEventIn('inaugurou em agosto de 2026 sua segunda unidade')).toBe(true);
    expect(expansionEventIn('A Rede Animália abre nova loja em Cambé')).toBe(true);
    expect(expansionEventIn('vai abrir unidade no bairro Portão')).toBe(true);
    expect(expansionEventIn('planeja abrir duas lojas em Campinas no próximo ano')).toBe(true);
    expect(expansionEventIn('Clínica Exemplo ganha mais uma unidade em Franca')).toBe(true);
    expect(expansionEventIn('A terceira loja da rede foi aberta em março')).toBe(true);
    expect(expansionEventIn('Em breve, mais uma unidade no Centro')).toBe(true);
    expect(expansionEventIn('A empresa anunciou a expansão para o interior')).toBe(true);
  });

  it('slogan com "nova", "expansão" ou verbo solto não é expansão (revisão do KI-148)', () => {
    expect(expansionEventIn('A nova forma de cuidar do seu pet')).toBe(false);
    expect(expansionEventIn('Rede em expansão: a maior do Sul')).toBe(false);
    expect(expansionEventIn('Abre às 8h, de segunda a sábado')).toBe(false);
    expect(expansionEventIn('Sempre próximo de você')).toBe(false);
    expect(expansionEventIn('Loja de material de construção no Centro')).toBe(false);
    expect(expansionEventIn('Instalações modernas e equipe especializada')).toBe(false);
    expect(expansionEventIn('Anuncie aqui sua empresa')).toBe(false);
    expect(expansionEventIn('Chegou a hora de cuidar do seu pet')).toBe(false);
    expect(expansionEventIn('Presente em 20 unidades no Paraná')).toBe(false);
    expect(expansionEventIn('Móveis planejados sob medida')).toBe(false);
    expect(expansionEventIn('Ganhe desconto na primeira consulta')).toBe(false);
  });

  it('outras formas de expansão passam (revisão do KI-148)', () => {
    expect(expansionEventIn('A rede desembarca em Maringá no mês que vem')).toBe(true);
    expect(expansionEventIn('Marca paulista estreia em Cascavel')).toBe(true);
    expect(expansionEventIn('Clínica começa a atender em Ponta Grossa')).toBe(true);
    expect(expansionEventIn('Pet shop reinaugura loja ampliada no Centro')).toBe(true);
    expect(expansionEventIn('A 3ª unidade da rede fica na Av. Brasil')).toBe(true);
    expect(expansionEventIn('Escola de idiomas inaugura a 2ª unidade')).toBe(true);
    expect(expansionEventIn('Rede chega a Arapongas com loja de 300 m²')).toBe(true);
    expect(expansionEventIn('Plano de expansão prevê 5 lojas até 2027')).toBe(true);
    expect(expansionEventIn('A empresa se instala em Toledo')).toBe(true);
    expect(expansionEventIn('A loja mudou para um endereço maior')).toBe(true);
  });

  it('notícias com outras formas passam (segunda revisão do KI-148)', () => {
    expect(expansionEventIn('Rede de academias estreia primeira unidade no Paraná')).toBe(true);
    expect(expansionEventIn('Clínica Sorriso agora também em Cambé')).toBe(true);
    expect(expansionEventIn('Farmácia X terá loja em Londrina a partir de dezembro')).toBe(true);
    expect(expansionEventIn('Rede Y leva sua operação para Ribeirão Preto')).toBe(true);
    expect(expansionEventIn('A rede vai somar 40 lojas até o fim do ano')).toBe(true);
    expect(expansionEventIn('Loja X reabre no shopping após reforma')).toBe(true);
    expect(expansionEventIn('Rede de óticas X amplia presença no Nordeste')).toBe(true);
    expect(expansionEventIn('Supermercado inaugurou no sábado sua unidade no Jardim')).toBe(true);
  });

  it('história, horário, entrega, especialidade, pontos e serviço não são expansão', () => {
    expect(expansionEventIn('Fundada em 1998, a clínica foi inaugurada em 2005 no Centro')).toBe(
      false,
    );
    expect(expansionEventIn('Inaugurada em 1987, a padaria é tradição em Piracicaba')).toBe(false);
    expect(expansionEventIn('Abrimos no sábado e nos feriados')).toBe(false);
    expect(expansionEventIn('Seu pedido chega em até 2 horas')).toBe(false);
    expect(expansionEventIn('Entrega rápida: chega no mesmo dia')).toBe(false);
    expect(expansionEventIn('Especialistas em reforma de apartamentos e casas')).toBe(false);
    expect(expansionEventIn('Construtora especializada em construção civil')).toBe(false);
    expect(expansionEventIn('Acumule novos pontos e troque por descontos')).toBe(false);
    expect(expansionEventIn('Ampliação de cílios e design de sobrancelhas')).toBe(false);
    expect(expansionEventIn('Amplia seu sorriso com lentes de contato dental')).toBe(false);
    expect(expansionEventIn('Instala em sua casa em até 24 horas')).toBe(false);
    expect(expansionEventIn('Nova coleção chegou na loja')).toBe(false);
  });

  it('"inaugurada em <ano>" só conta com o ano da pesquisa ou o anterior', () => {
    const quote = 'A segunda loja foi inaugurada em 2026, no Centro';
    expect(expansionEventIn('A loja foi inaugurada em 2026', 2026)).toBe(true);
    expect(expansionEventIn('A loja foi inaugurada em 2025', 2026)).toBe(true);
    expect(expansionEventIn('A loja foi inaugurada em 2019', 2026)).toBe(false);
    expect(expansionEventIn('A loja foi inaugurada em 2026')).toBe(false);
    // Outra marca de acontecimento no trecho continua valendo.
    expect(expansionEventIn(quote)).toBe(true);
    expect(expansionEventIn('Em obras: a nova unidade abre em março')).toBe(true);
  });
});
