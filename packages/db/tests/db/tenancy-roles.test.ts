import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDb,
  expectDbError,
  testEmail,
  testSlug,
  type Queryable,
  type TestDb,
  type TestUser,
} from '../support/test-db';

const createOrg = (q: Queryable, name: string) =>
  q
    .query<{ id: string }>('select public.create_organization($1, $2) as id', [
      name,
      testSlug('org'),
    ])
    .then((r) => r[0]!.id);

const invite = (q: Queryable, orgId: string, email: string, role: string) =>
  q
    .query<{ inv: { invitationId: string; token: string; expiresAt: string } }>(
      'select public.create_invitation($1, $2, $3) as inv',
      [orgId, email, role],
    )
    .then((r) => r[0]!.inv);

const accept = (q: Queryable, token: string) =>
  q
    .query<{ r: { orgId: string; slug: string } }>('select public.accept_invitation($1) as r', [
      token,
    ])
    .then((r) => r[0]!.r);

describe('papéis, convites e auditoria', () => {
  let db: TestDb;
  let owner: TestUser;
  let admin: TestUser;
  let operator: TestUser;
  let viewer: TestUser;
  let orgId: string;

  async function addMember(user: TestUser, role: string) {
    const inv = await db.asUser(owner.id, (q) => invite(q, orgId, user.email, role));
    await db.asUser(user.id, (q) => accept(q, inv.token));
  }

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createUser({ fullName: 'Dona Teste' });
    admin = await db.createUser();
    operator = await db.createUser();
    viewer = await db.createUser();
    orgId = await db.asUser(owner.id, (q) => createOrg(q, 'Estúdio Teste'));
    await addMember(admin, 'admin');
    await addMember(operator, 'operator');
    await addMember(viewer, 'viewer');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('criação de organização', () => {
    it('quem cria vira owner', async () => {
      const rows = await db.asUser(owner.id, (q) =>
        q.query<{ role: string }>(
          'select role from public.memberships where org_id = $1 and user_id = $2',
          [orgId, owner.id],
        ),
      );
      expect(rows).toEqual([{ role: 'owner' }]);
    });

    it('slug repetido e entradas inválidas são recusados', async () => {
      const [org] = await db.query<{ slug: string }>(
        'select slug from public.organizations where id = $1',
        [orgId],
      );
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('select public.create_organization($1, $2)', ['Outra', org!.slug]),
        ),
        {
          message: 'slug_taken',
        },
      );
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('select public.create_organization($1, $2)', ['Outra', 'Slug Inválido']),
        ),
        {
          code: '23514',
        },
      );
    });
  });

  describe('convites', () => {
    it('token tem 64 hex e o banco guarda apenas o hash', async () => {
      const email = testEmail('hash');
      const inv = await db.asUser(owner.id, (q) => invite(q, orgId, email, 'viewer'));
      expect(inv.token).toMatch(/^[a-f0-9]{64}$/);
      const [row] = await db.query<{ token_hash: string }>(
        'select token_hash from public.invitations where id = $1',
        [inv.invitationId],
      );
      expect(row!.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(row!.token_hash).not.toBe(inv.token);
    });

    it('a coluna token_hash não é legível pelo usuário', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) => q.query('select token_hash from public.invitations')),
        { code: '42501' },
      );
    });

    it('somente admin/owner convidam; ninguém convida como owner', async () => {
      await expectDbError(
        db.asUser(viewer.id, (q) => invite(q, orgId, testEmail('v'), 'viewer')),
        { message: 'not_admin' },
      );
      await expectDbError(
        db.asUser(operator.id, (q) => invite(q, orgId, testEmail('o'), 'viewer')),
        { message: 'not_admin' },
      );
      await expectDbError(
        db.asUser(owner.id, (q) => invite(q, orgId, testEmail('own'), 'owner')),
        { message: 'owner_only' },
      );
      const inv = await db.asUser(admin.id, (q) => invite(q, orgId, testEmail('a'), 'admin'));
      expect(inv.invitationId).toBeTruthy();
    });

    it('convite duplicado pendente e convite para quem já é membro são recusados', async () => {
      const email = testEmail('dup');
      await db.asUser(owner.id, (q) => invite(q, orgId, email, 'viewer'));
      await expectDbError(
        db.asUser(owner.id, (q) => invite(q, orgId, email.toUpperCase(), 'viewer')),
        { message: 'invitation_pending' },
      );
      await expectDbError(
        db.asUser(owner.id, (q) => invite(q, orgId, viewer.email, 'operator')),
        { message: 'already_member' },
      );
    });

    it('só a pessoa convidada, com e-mail confirmado, aceita o convite', async () => {
      const invited = await db.createUser();
      const intruder = await db.createUser();
      const inv = await db.asUser(owner.id, (q) => invite(q, orgId, invited.email, 'operator'));
      await expectDbError(
        db.asUser(intruder.id, (q) => accept(q, inv.token)),
        { message: 'invitation_email_mismatch' },
      );

      const result = await db.asUser(invited.id, (q) => accept(q, inv.token));
      expect(result.orgId).toBe(orgId);
      await expectDbError(
        db.asUser(invited.id, (q) => accept(q, inv.token)),
        { message: 'invitation_invalid' },
      );
    });

    it('e-mail não confirmado não aceita convite', async () => {
      const unconfirmed = await db.createUser({ confirmed: false });
      const inv = await db.asUser(owner.id, (q) => invite(q, orgId, unconfirmed.email, 'viewer'));
      await expectDbError(
        db.asUser(unconfirmed.id, (q) => accept(q, inv.token)),
        { message: 'email_not_confirmed' },
      );
    });

    it('convite expirado ou revogado não é aceito', async () => {
      const late = await db.createUser();
      const inv = await db.asUser(owner.id, (q) => invite(q, orgId, late.email, 'viewer'));
      await db.query(
        "update public.invitations set expires_at = now() - interval '1 minute' where id = $1",
        [inv.invitationId],
      );
      await expectDbError(
        db.asUser(late.id, (q) => accept(q, inv.token)),
        { message: 'invitation_expired' },
      );

      // Um novo convite substitui o vencido.
      const fresh = await db.asUser(owner.id, (q) => invite(q, orgId, late.email, 'viewer'));
      await db.asUser(admin.id, (q) =>
        q.query('select public.revoke_invitation($1, $2)', [orgId, fresh.invitationId]),
      );
      await expectDbError(
        db.asUser(late.id, (q) => accept(q, fresh.token)),
        { message: 'invitation_invalid' },
      );
    });

    it('token malformado é recusado sem consulta', async () => {
      await expectDbError(
        db.asUser(viewer.id, (q) => accept(q, 'nao-e-token')),
        { message: 'invitation_invalid' },
      );
    });
  });

  describe('convites depois que quem convidou deixa de administrar', () => {
    const statusOf = (invitationId: string) =>
      db
        .query<{ status: string }>('select status from public.invitations where id = $1', [
          invitationId,
        ])
        .then((rows) => rows[0]?.status);

    it('papel inexistente é recusado como entrada inválida', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) => invite(q, orgId, testEmail('root'), 'root')),
        { message: 'invalid_input' },
      );
    });

    it('remover quem convidou revoga os convites pendentes que essa pessoa emitiu', async () => {
      const tempAdmin = await db.createUser();
      await addMember(tempAdmin, 'admin');
      const target = await db.createUser();
      const inv = await db.asUser(tempAdmin.id, (q) => invite(q, orgId, target.email, 'admin'));

      await db.asUser(owner.id, (q) =>
        q.query('select public.remove_member($1, $2)', [orgId, tempAdmin.id]),
      );

      expect(await statusOf(inv.invitationId)).toBe('revoked');
      await expectDbError(
        db.asUser(target.id, (q) => accept(q, inv.token)),
        { message: 'invitation_invalid' },
      );
    });

    it('rebaixar quem convidou abaixo de admin revoga os convites pendentes', async () => {
      const tempAdmin = await db.createUser();
      await addMember(tempAdmin, 'admin');
      const target = await db.createUser();
      const inv = await db.asUser(tempAdmin.id, (q) => invite(q, orgId, target.email, 'viewer'));

      await db.asUser(owner.id, (q) =>
        q.query('select public.change_member_role($1, $2, $3)', [orgId, tempAdmin.id, 'operator']),
      );

      expect(await statusOf(inv.invitationId)).toBe('revoked');
      await expectDbError(
        db.asUser(target.id, (q) => accept(q, inv.token)),
        { message: 'invitation_invalid' },
      );
    });

    it('o aceite recusa convite pendente cujo autor não administra mais a organização', async () => {
      // Defesa em profundidade: mesmo que um convite pendente escape da revogação, o aceite
      // confere quem convidou.
      const target = await db.createUser();
      const inv = await db.asUser(owner.id, (q) => invite(q, orgId, target.email, 'viewer'));
      await db.query('update public.invitations set invited_by = $1 where id = $2', [
        operator.id,
        inv.invitationId,
      ]);
      await expectDbError(
        db.asUser(target.id, (q) => accept(q, inv.token)),
        { message: 'invitation_invalid' },
      );
    });
  });

  describe('alteração de papéis e remoção', () => {
    it('viewer e operator não alteram papéis', async () => {
      await expectDbError(
        db.asUser(viewer.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, operator.id, 'viewer']),
        ),
        {
          message: 'not_admin',
        },
      );
      await expectDbError(
        db.asUser(operator.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, viewer.id, 'operator']),
        ),
        {
          message: 'not_admin',
        },
      );
    });

    it('ninguém altera o próprio papel', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, owner.id, 'admin']),
        ),
        {
          message: 'self_change',
        },
      );
    });

    it('admin não mexe em owner nem promove a owner', async () => {
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, owner.id, 'viewer']),
        ),
        {
          message: 'owner_only',
        },
      );
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, viewer.id, 'owner']),
        ),
        {
          message: 'owner_only',
        },
      );
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('select public.remove_member($1, $2)', [orgId, owner.id]),
        ),
        {
          message: 'owner_only',
        },
      );
    });

    it('admin altera papéis abaixo de owner e a mudança vale no banco', async () => {
      await db.asUser(admin.id, (q) =>
        q.query('select public.change_member_role($1, $2, $3)', [orgId, viewer.id, 'operator']),
      );
      // Agora operador: ainda não convida (regra de papel aplicada pelo banco).
      await expectDbError(
        db.asUser(viewer.id, (q) => invite(q, orgId, testEmail('x'), 'viewer')),
        { message: 'not_admin' },
      );
      await db.asUser(admin.id, (q) =>
        q.query('select public.change_member_role($1, $2, $3)', [orgId, viewer.id, 'viewer']),
      );
    });

    it('papel desconhecido é recusado', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) =>
          q.query('select public.change_member_role($1, $2, $3)', [orgId, viewer.id, 'root']),
        ),
        {
          message: 'invalid_input',
        },
      );
    });

    it('membro removido perde o acesso imediatamente', async () => {
      const temp = await db.createUser();
      await addMember(temp, 'viewer');
      expect(
        await db.asUser(temp.id, (q) => q.query('select id from public.organizations')),
      ).toHaveLength(1);
      await db.asUser(admin.id, (q) =>
        q.query('select public.remove_member($1, $2)', [orgId, temp.id]),
      );
      expect(
        await db.asUser(temp.id, (q) => q.query('select id from public.organizations')),
      ).toEqual([]);
    });
  });

  describe('edição direta de tabelas', () => {
    it('admin altera o nome da organização, mas não slug nem selo de demonstração', async () => {
      const updated = await db.asUser(admin.id, (q) =>
        q.query('update public.organizations set name = $1 where id = $2 returning id', [
          'Estúdio Teste Renomeado',
          orgId,
        ]),
      );
      expect(updated).toHaveLength(1);
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('update public.organizations set slug = $1 where id = $2', ['novo-slug', orgId]),
        ),
        {
          code: '42501',
        },
      );
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query('update public.organizations set is_demo = true where id = $1', [orgId]),
        ),
        {
          code: '42501',
        },
      );
    });

    it('operator e viewer não alteram a organização', async () => {
      for (const user of [operator, viewer]) {
        const updated = await db.asUser(user.id, (q) =>
          q.query('update public.organizations set name = $1 where id = $2 returning id', [
            'Tentativa',
            orgId,
          ]),
        );
        expect(updated).toEqual([]);
      }
    });

    it('configurações da organização não são editáveis diretamente', async () => {
      await expectDbError(
        db.asUser(admin.id, (q) =>
          q.query(`update public.organizations set settings = '{"a": 1}'::jsonb where id = $1`, [
            orgId,
          ]),
        ),
        { code: '42501' },
      );
    });

    it('cada usuário edita apenas o próprio perfil e não altera o e-mail', async () => {
      const mine = await db.asUser(viewer.id, (q) =>
        q.query('update public.profiles set full_name = $1 where user_id = $2 returning user_id', [
          'Novo Nome',
          viewer.id,
        ]),
      );
      expect(mine).toHaveLength(1);
      const others = await db.asUser(viewer.id, (q) =>
        q.query('update public.profiles set full_name = $1 where user_id = $2 returning user_id', [
          'Invasão',
          owner.id,
        ]),
      );
      expect(others).toEqual([]);
      await expectDbError(
        db.asUser(viewer.id, (q) =>
          q.query('update public.profiles set email = $1 where user_id = $2', [
            'x@example.test',
            viewer.id,
          ]),
        ),
        { code: '42501' },
      );
    });
  });

  describe('audit_log', () => {
    it('registra convite e mudança de papel com autor e diferença, sem o hash do token', async () => {
      const target = await db.createUser();
      const inv = await db.asUser(admin.id, (q) => invite(q, orgId, target.email, 'viewer'));
      await db.asUser(target.id, (q) => accept(q, inv.token));
      await db.asUser(owner.id, (q) =>
        q.query('select public.change_member_role($1, $2, $3)', [orgId, target.id, 'operator']),
      );

      const entries = await db.asUser(owner.id, (q) =>
        q.query<{
          action: string;
          actor_id: string;
          entity_id: string;
          diff: Record<string, unknown>;
        }>(
          `select action, actor_id, entity_id, diff from public.audit_log
           where org_id = $1 and (entity_id = $2 or entity_id = $3) order by id`,
          [orgId, inv.invitationId, target.id],
        ),
      );
      const actions = entries.map((e) => e.action);
      expect(actions).toContain('invitations.insert');
      expect(actions).toContain('memberships.insert');
      expect(actions).toContain('invitations.update');
      const roleChange = entries.find((e) => e.action === 'memberships.update');
      expect(roleChange?.actor_id).toBe(owner.id);
      expect(roleChange?.diff).toEqual({ role: { from: 'viewer', to: 'operator' } });
      const inviteEntry = entries.find((e) => e.action === 'invitations.insert');
      expect(inviteEntry?.actor_id).toBe(admin.id);
      expect(inviteEntry?.diff).not.toHaveProperty('token_hash');
    });

    it('registra remoção de membro e revogação de convite com autor', async () => {
      const temp = await db.createUser();
      await addMember(temp, 'viewer');
      await db.asUser(admin.id, (q) =>
        q.query('select public.remove_member($1, $2)', [orgId, temp.id]),
      );
      const pending = await db.asUser(owner.id, (q) =>
        invite(q, orgId, testEmail('revogar'), 'viewer'),
      );
      await db.asUser(admin.id, (q) =>
        q.query('select public.revoke_invitation($1, $2)', [orgId, pending.invitationId]),
      );

      const entries = await db.asUser(owner.id, (q) =>
        q.query<{ action: string; actor_id: string; diff: Record<string, unknown> }>(
          `select action, actor_id, diff from public.audit_log
           where org_id = $1 and entity_id in ($2, $3) order by id`,
          [orgId, temp.id, pending.invitationId],
        ),
      );
      const removal = entries.find((e) => e.action === 'memberships.delete');
      expect(removal?.actor_id).toBe(admin.id);
      expect(removal?.diff).toMatchObject({ user_id: temp.id, role: 'viewer' });
      const revocation = entries.find((e) => e.action === 'invitations.update');
      expect(revocation?.actor_id).toBe(admin.id);
      expect(revocation?.diff).toMatchObject({ status: { from: 'pending', to: 'revoked' } });
    });

    it('update e delete falham para todos os papéis, inclusive o dono do banco', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) => q.query("update public.audit_log set action = 'x'")),
        { code: '42501' },
      );
      await expectDbError(
        db.asUser(owner.id, (q) => q.query('delete from public.audit_log')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole('service_role', (q) => q.query('delete from public.audit_log')),
        { code: '42501' },
      );
      await expectDbError(db.query("update public.audit_log set action = 'x'"), {
        message: 'audit_log_append_only',
      });
      await expectDbError(db.query('delete from public.audit_log'), {
        message: 'audit_log_append_only',
      });
      await expectDbError(db.query('truncate public.audit_log'), {
        message: 'audit_log_append_only',
      });
    });

    it('usuários não inserem diretamente no audit_log', async () => {
      await expectDbError(
        db.asUser(owner.id, (q) =>
          q.query(
            "insert into public.audit_log (org_id, actor_type, action, entity_type) values ($1, 'user', 'forjado', 'x')",
            [orgId],
          ),
        ),
        { code: '42501' },
      );
    });
  });
});
