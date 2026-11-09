import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, SignInInput, SignUpInput } from '../src';

describe('SignUpInput', () => {
  it('normaliza e-mail e nome', () => {
    const parsed = SignUpInput.parse({
      fullName: '  Ana Teste ',
      email: ' Ana@Example.TEST ',
      password: 'x'.repeat(12),
    });
    expect(parsed).toEqual({
      fullName: 'Ana Teste',
      email: 'ana@example.test',
      password: 'x'.repeat(12),
    });
  });

  it.each([
    [
      'senha curta',
      { fullName: 'Ana', email: 'ana@example.test', password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) },
    ],
    [
      'senha acima do limite do bcrypt',
      { fullName: 'Ana', email: 'ana@example.test', password: 'x'.repeat(73) },
    ],
    ['e-mail inválido', { fullName: 'Ana', email: 'ana', password: 'x'.repeat(12) }],
    ['nome vazio', { fullName: ' ', email: 'ana@example.test', password: 'x'.repeat(12) }],
  ])('rejeita %s', (_, input) => {
    expect(SignUpInput.safeParse(input).success).toBe(false);
  });
});

describe('SignInInput', () => {
  it('exige senha, mas não aplica a regra de comprimento de cadastro', () => {
    expect(SignInInput.safeParse({ email: 'ana@example.test', password: 'curta' }).success).toBe(
      true,
    );
    expect(SignInInput.safeParse({ email: 'ana@example.test', password: '' }).success).toBe(false);
  });
});
