import { describe, expect, it } from 'vitest';
import { measureCompanyLanguage } from '../../src/commercial/language';

/** Trechos SINTÉTICOS, escritos para o teste. */
describe('linguagem pública da empresa (Parte 5.2)', () => {
  it('pouco texto não vira medida', () => {
    expect(measureCompanyLanguage(['Pagamentos para o seu negócio.'], 'Veloz')).toBeNull();
    expect(measureCompanyLanguage(['Oi!', 'Tudo certo.'], 'Veloz')).toBeNull();
  });

  it('texto que fala com "você" e usa exclamação é informal, em segunda pessoa', () => {
    const language = measureCompanyLanguage(
      [
        'Com a Veloz você recebe na hora! Seu dinheiro cai na conta em segundos.',
        'Pagamentos sem complicação pra você vender mais. Confira as taxas!',
        'Você controla seus recebimentos pelo app, sem burocracia e sem taxas escondidas.',
      ],
      'Veloz Pagamentos Sintética',
    );
    expect(language).toMatchObject({ formality: 'informal', address: 'second_person', samples: 3 });
    // Palavras que se repetem em mais de um trecho, na forma escrita (com acento); o nome fica fora.
    expect(language?.terms).toContain('taxas');
    expect(language?.terms).not.toContain('veloz');
  });

  it('texto institucional em terceira pessoa é formal', () => {
    const language = measureCompanyLanguage(
      [
        'A empresa atua com excelência e comprometimento na entrega de soluções logísticas.',
        'Nossa missão é oferecer soluções integradas aos nossos clientes, com valores sólidos.',
        'Nossos colaboradores são comprometidos com a qualidade das soluções institucionais.',
      ],
      'Transportes Sintéticos',
    );
    expect(language).toMatchObject({ formality: 'formal', address: 'third_person' });
    expect(language?.terms).toContain('soluções');
  });

  it('trecho repetido conta uma vez', () => {
    const repeated = 'Atendimento humano e próximo para cada pessoa que chega até nós.';
    expect(measureCompanyLanguage([repeated, repeated, repeated], 'Clínica')).toBeNull();
  });
});
