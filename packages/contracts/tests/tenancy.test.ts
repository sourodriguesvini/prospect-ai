import { describe, expect, it } from 'vitest';
import {
  AcceptInvitationInput,
  ChangeMemberRoleInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  ORG_SLUG_PATTERN,
} from '../src';

const ORG = '3f1d2c4b-8a7e-4c1d-9b2a-5e6f7a8b9c0d';
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('CreateOrganizationInput', () => {
  it('aceita nome e slug válidos e normaliza o slug', () => {
    const parsed = CreateOrganizationInput.parse({
      name: '  Estúdio Norte ',
      slug: 'Estudio-Norte',
    });
    expect(parsed).toEqual({ name: 'Estúdio Norte', slug: 'estudio-norte' });
  });

  it.each([
    ['nome curto', { name: 'A', slug: 'abc' }],
    ['slug com hífen na ponta', { name: 'Agência', slug: '-abc' }],
    ['slug com acento', { name: 'Agência', slug: 'agência' }],
    ['slug curto', { name: 'Agência', slug: 'ab' }],
    ['slug longo', { name: 'Agência', slug: 'a'.repeat(49) }],
  ])('rejeita %s', (_, input) => {
    expect(CreateOrganizationInput.safeParse(input).success).toBe(false);
  });

  it('o padrão de slug é o mesmo aplicado no banco', () => {
    expect(ORG_SLUG_PATTERN.test('a1-b2')).toBe(true);
    expect(ORG_SLUG_PATTERN.test('a--b')).toBe(true);
    expect(ORG_SLUG_PATTERN.test('ab')).toBe(false);
  });
});

describe('CreateInvitationInput', () => {
  it('normaliza o e-mail para minúsculas', () => {
    const parsed = CreateInvitationInput.parse({
      orgId: ORG,
      email: ' Ana@Agencia.Example.Test ',
      role: 'operator',
    });
    expect(parsed.email).toBe('ana@agencia.example.test');
  });

  it('não permite convidar como owner', () => {
    expect(
      CreateInvitationInput.safeParse({ orgId: ORG, email: 'a@example.test', role: 'owner' })
        .success,
    ).toBe(false);
  });

  it('rejeita e-mail e org inválidos', () => {
    expect(
      CreateInvitationInput.safeParse({ orgId: ORG, email: 'sem-arroba', role: 'viewer' }).success,
    ).toBe(false);
    expect(
      CreateInvitationInput.safeParse({ orgId: 'x', email: 'a@example.test', role: 'viewer' })
        .success,
    ).toBe(false);
  });
});

describe('AcceptInvitationInput', () => {
  it('aceita somente 64 caracteres hexadecimais', () => {
    expect(AcceptInvitationInput.safeParse({ token: 'a'.repeat(64) }).success).toBe(true);
    expect(AcceptInvitationInput.safeParse({ token: 'A'.repeat(64) }).success).toBe(false);
    expect(AcceptInvitationInput.safeParse({ token: 'a'.repeat(63) }).success).toBe(false);
  });
});

describe('ChangeMemberRoleInput', () => {
  it('aceita qualquer papel conhecido e rejeita desconhecidos', () => {
    expect(
      ChangeMemberRoleInput.safeParse({ orgId: ORG, userId: USER, role: 'owner' }).success,
    ).toBe(true);
    expect(
      ChangeMemberRoleInput.safeParse({ orgId: ORG, userId: USER, role: 'root' }).success,
    ).toBe(false);
  });
});
