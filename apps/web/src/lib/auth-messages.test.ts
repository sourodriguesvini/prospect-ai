import { describe, expect, it } from 'vitest';
import {
  AUTH_UNAVAILABLE,
  authErrorMessage,
  isConcealedSignUpError,
  parseConfirmLink,
} from './auth-messages';

describe('authErrorMessage', () => {
  it('traduz códigos conhecidos', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('E-mail ou senha incorretos.');
  });

  it('não repassa mensagens desconhecidas do provedor', () => {
    expect(authErrorMessage({ code: 'qualquer_outro' })).toBe(AUTH_UNAVAILABLE);
    expect(authErrorMessage({})).toBe(AUTH_UNAVAILABLE);
  });
});

describe('isConcealedSignUpError (não revelar quem tem conta)', () => {
  it('esconde e-mail já cadastrado', () => {
    expect(isConcealedSignUpError('user_already_exists')).toBe(true);
    expect(isConcealedSignUpError('email_exists')).toBe(true);
  });

  it('não esconde outros erros', () => {
    expect(isConcealedSignUpError('weak_password')).toBe(false);
    expect(isConcealedSignUpError(undefined)).toBe(false);
  });
});

describe('parseConfirmLink', () => {
  it('aceita token_hash de confirmação de cadastro', () => {
    expect(parseConfirmLink({ token_hash: 'abc', type: 'email' })).toEqual({
      tokenHash: 'abc',
      type: 'email',
    });
    expect(parseConfirmLink({ token_hash: 'abc', type: 'signup' })).toEqual({
      tokenHash: 'abc',
      type: 'signup',
    });
  });

  it('recusa tipos de link de fluxos que ainda não existem', () => {
    for (const type of ['magiclink', 'invite', 'email_change', 'recovery', 'qualquer']) {
      expect(parseConfirmLink({ token_hash: 'abc', type })).toBeNull();
    }
  });

  it('aceita o formato PKCE com code', () => {
    expect(parseConfirmLink({ code: 'xyz' })).toEqual({ code: 'xyz' });
  });

  it('recusa link vazio', () => {
    expect(parseConfirmLink({})).toBeNull();
    expect(parseConfirmLink({ token_hash: 'abc' })).toBeNull();
  });
});
