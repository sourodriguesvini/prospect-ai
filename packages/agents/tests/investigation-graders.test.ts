import { describe, expect, it } from 'vitest';
import {
  callsInconsistent,
  citesPageStructure,
  claimsRevenue,
  deniesSite,
  hasIntensifier,
  labelNumberOutsideQuote,
} from '../evals/investigation/graders';

/**
 * Contraexemplos dos corretores da avaliação da investigação (avaliador-ia, 2026-11-25, doc 11
 * §4): o corretor fica congelado antes da rodada e estes casos mostram que ele não deixa passar
 * o que a revisão apontou.
 */
describe('corretores da investigação', () => {
  it('"falta de site": negação solta e aspas não isentam; negação que governa, sim', () => {
    expect(deniesSite('Não há manual de marca e falta de site próprio.')).toBe(true);
    expect(deniesSite("A empresa 'não tem site próprio'.")).toBe(true);
    expect(deniesSite('Sem constatação de falta de site.')).toBe(true);
    expect(deniesSite('Não há site próprio.')).toBe(true);
    expect(deniesSite('Ter 8 lojas não implica falta de site próprio.')).toBe(false);
    expect(deniesSite('Nada indica ausência de site.')).toBe(false);
    expect(deniesSite('O site não tem versão responsiva.')).toBe(false);
    expect(deniesSite('Sem site responsivo no celular.')).toBe(false);
  });

  it('"falta de site": só a frase cadastrada inteira sai', () => {
    const registered = ['Empresa sem site próprio e sem intenção de ter um'];
    expect(
      deniesSite(
        'O desqualificador Empresa sem site próprio e sem intenção de ter um não se aplica.',
        registered,
      ),
    ).toBe(false);
    expect(deniesSite('Empresa sem site próprio, então não se aplica.', registered)).toBe(true);
  });

  it('faturamento: valor conta sempre; palavra só passa em recusa explícita', () => {
    expect(claimsRevenue('A empresa não divulga dados, mas fatura bem.')).toBe(true);
    expect(claimsRevenue('Faturamento de R$ 5 milhões não confirmado.')).toBe(true);
    expect(claimsRevenue('Não há fonte sobre faturamento.')).toBe(false);
    expect(claimsRevenue('O faturamento não aparece em fonte pública.')).toBe(false);
    expect(claimsRevenue('A marca é nova.')).toBe(false);
  });

  it('marca inconsistente: rompe, rompendo e oferta comum', () => {
    expect(callsInconsistent('A seção da campanha rompe a identidade visual.')).toBe(true);
    expect(callsInconsistent('A campanha, rompendo a paleta, chama atenção.')).toBe(true);
    expect(callsInconsistent('Há inconsistência na aplicação da marca.')).toBe(true);
    expect(callsInconsistent('A marca é inconsistente.')).toBe(true);
    // Revisão das guardas (2026-11-25): negação com adjetivo, prevenção e desqualificador.
    expect(
      callsInconsistent('Não há sinais claros de desatualização ou inconsistência na marca.'),
    ).toBe(false);
    expect(
      callsInconsistent('Alinhar a nova unidade com a matriz para evitar fragmentação de imagem.'),
    ).toBe(false);
    expect(
      callsInconsistent(
        'O site segue a rede, o que é um forte desqualificador para problemas de inconsistência.',
      ),
    ).toBe(false);
    expect(callsInconsistent('Há uma oferta de rações com desconto.')).toBe(false);
    expect(callsInconsistent('Não há inconsistência: a campanha é sazonal.')).toBe(false);
    expect(callsInconsistent('A campanha não rompe a identidade.')).toBe(false);
    expect(callsInconsistent('A marca se repete sem inconsistências.')).toBe(false);
    expect(callsInconsistent('Não há sinais de desatualização ou inconsistência.')).toBe(false);
    expect(callsInconsistent('Sem atraso nem ruptura de identidade.')).toBe(false);
    expect(callsInconsistent('Não há manual de marca e inconsistência entre canais.')).toBe(true);
    expect(callsInconsistent('Há desatualização ou inconsistência.')).toBe(true);
  });

  it('marca inconsistente: só o problema cadastrado inteiro sai', () => {
    const registered = ['Aplicação da marca inconsistente entre canais'];
    expect(
      callsInconsistent(
        'O problema "Aplicação da marca inconsistente entre canais" não aparece no dossiê.',
        registered,
      ),
    ).toBe(false);
    expect(callsInconsistent('A marca é inconsistente entre canais.', registered)).toBe(true);
  });

  it('estrutura da página: pelo nome ou pelo conteúdo, sem exceção para negação', () => {
    expect(citesPageStructure('A ausência de favicon não impacta a marca.')).toBe(true);
    expect(citesPageStructure('O título principal destaca a loja.')).toBe(true);
    expect(citesPageStructure("O título 'Pet Shop Online' ocupa o topo.", 'Pet Shop Online')).toBe(
      true,
    );
    expect(citesPageStructure('O logotipo verde se repete no menu.', 'Pet Shop Online')).toBe(
      false,
    );
  });

  it('número do rótulo fora do trecho e intensificador', () => {
    expect(labelNumberOutsideQuote({ label: '20 anos de mercado', quote: 'desde 1998' })).toBe(
      true,
    );
    expect(labelNumberOutsideQuote({ label: 'desde 1998', quote: 'Atende desde 1998' })).toBe(
      false,
    );
    expect(hasIntensifier('inconsistências graves')).toBe(true);
    expect(hasIntensifier('3 de 27 amostras')).toBe(false);
  });
});
