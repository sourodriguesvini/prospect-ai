import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDb,
  expectDbError,
  testSlug,
  type TestDb,
  type TestUser,
} from '../support/test-db';

/**
 * Isolamento entre organizações: um usuário da org B não lê nem altera nada da org A,
 * nem por consulta direta nem pelas RPCs.
 */
describe('isolamento entre organizações', () => {
  let db: TestDb;
  let alice: TestUser; // owner da org A
  let carol: TestUser; // viewer da org A
  let bob: TestUser; // owner da org B
  let orgA: string;
  let orgB: string;
  let invitationA: string;

  beforeAll(async () => {
    db = await createTestDb();
    alice = await db.createUser({ fullName: 'Alice Teste' });
    carol = await db.createUser({ fullName: 'Carol Teste' });
    bob = await db.createUser({ fullName: 'Bob Teste' });

    orgA = await db.asUser(alice.id, async (q) => {
      const [row] = await q.query<{ id: string }>(
        'select public.create_organization($1, $2) as id',
        ['Agência A', testSlug('org-a')],
      );
      return row!.id;
    });
    orgB = await db.asUser(bob.id, async (q) => {
      const [row] = await q.query<{ id: string }>(
        'select public.create_organization($1, $2) as id',
        ['Agência B', testSlug('org-b')],
      );
      return row!.id;
    });

    const invite = await db.asUser(alice.id, async (q) => {
      const [row] = await q.query<{ inv: { token: string } }>(
        'select public.create_invitation($1, $2, $3) as inv',
        [orgA, carol.email, 'viewer'],
      );
      return row!.inv;
    });
    await db.asUser(carol.id, (q) =>
      q.query('select public.accept_invitation($1)', [invite.token]),
    );

    invitationA = await db.asUser(alice.id, async (q) => {
      const [row] = await q.query<{ inv: { invitationId: string } }>(
        'select public.create_invitation($1, $2, $3) as inv',
        [orgA, 'pendente@example.test', 'operator'],
      );
      return row!.inv.invitationId;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('cada usuário só enxerga as organizações de que participa', async () => {
    const seenByBob = await db.asUser(bob.id, (q) =>
      q.query<{ id: string }>('select id from public.organizations'),
    );
    expect(seenByBob.map((r) => r.id)).toEqual([orgB]);

    const seenByCarol = await db.asUser(carol.id, (q) =>
      q.query<{ id: string }>('select id from public.organizations'),
    );
    expect(seenByCarol.map((r) => r.id)).toEqual([orgA]);
  });

  it('membros, perfis, convites e auditoria da org A são invisíveis para a org B', async () => {
    await db.asUser(bob.id, async (q) => {
      expect(await q.query('select * from public.memberships where org_id = $1', [orgA])).toEqual(
        [],
      );
      expect(await q.query('select id from public.invitations where org_id = $1', [orgA])).toEqual(
        [],
      );
      expect(await q.query('select id from public.audit_log where org_id = $1', [orgA])).toEqual(
        [],
      );
      const profiles = await q.query<{ user_id: string }>('select user_id from public.profiles');
      expect(profiles.map((p) => p.user_id)).toEqual([bob.id]);
    });
  });

  it('a org B não altera dados da org A', async () => {
    const updated = await db.asUser(bob.id, (q) =>
      q.query('update public.organizations set name = $1 where id = $2 returning id', [
        'Invadida',
        orgA,
      ]),
    );
    expect(updated).toEqual([]);
    const [org] = await db.query<{ name: string }>(
      'select name from public.organizations where id = $1',
      [orgA],
    );
    expect(org!.name).toBe('Agência A');
  });

  it('a org B não se insere como membro da org A', async () => {
    await expectDbError(
      db.asUser(bob.id, (q) =>
        q.query('insert into public.memberships (org_id, user_id, role) values ($1, $2, $3)', [
          orgA,
          bob.id,
          'owner',
        ]),
      ),
      { code: '42501' },
    );
  });

  it('RPCs de equipe recusam quem não é membro, sem revelar a organização', async () => {
    await expectDbError(
      db.asUser(bob.id, (q) =>
        q.query('select public.create_invitation($1, $2, $3)', [orgA, 'x@example.test', 'viewer']),
      ),
      {
        message: 'not_found',
      },
    );
    await expectDbError(
      db.asUser(bob.id, (q) =>
        q.query('select public.change_member_role($1, $2, $3)', [orgA, carol.id, 'admin']),
      ),
      {
        message: 'not_found',
      },
    );
    await expectDbError(
      db.asUser(bob.id, (q) => q.query('select public.remove_member($1, $2)', [orgA, carol.id])),
      {
        message: 'not_found',
      },
    );
    await expectDbError(
      db.asUser(bob.id, (q) =>
        q.query('select public.revoke_invitation($1, $2)', [orgA, invitationA]),
      ),
      {
        message: 'not_found',
      },
    );
  });

  it('viewer da org A vê a equipe, mas não convites nem auditoria', async () => {
    await db.asUser(carol.id, async (q) => {
      const members = await q.query<{ user_id: string }>(
        'select user_id from public.memberships where org_id = $1 order by created_at',
        [orgA],
      );
      expect(members.map((m) => m.user_id).sort()).toEqual([alice.id, carol.id].sort());
      const profiles = await q.query<{ user_id: string }>('select user_id from public.profiles');
      expect(profiles.map((p) => p.user_id).sort()).toEqual([alice.id, carol.id].sort());
      expect(await q.query('select id from public.invitations where org_id = $1', [orgA])).toEqual(
        [],
      );
      expect(await q.query('select id from public.audit_log where org_id = $1', [orgA])).toEqual(
        [],
      );
    });
  });

  it('anon não acessa nenhuma tabela de tenancy', async () => {
    for (const table of ['organizations', 'memberships', 'profiles', 'invitations', 'audit_log']) {
      await expectDbError(
        db.asRole('anon', (q) => q.query(`select 1 from public.${table} limit 1`)),
        { code: '42501' },
      );
    }
    await expectDbError(
      db.asRole('anon', (q) =>
        q.query('select public.create_organization($1, $2)', ['X', testSlug('anon')]),
      ),
      {
        code: '42501',
      },
    );
  });
});
