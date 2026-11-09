import { INVITABLE_ROLES, ROLE_LABELS, ROLES, type Member, type Role } from '@prospector/contracts';
import {
  canManageMembers,
  checkInvitation,
  checkMemberRemoval,
  checkRoleChange,
} from '@prospector/domain';
import { Badge, Button } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChangeRoleForm } from '@/components/forms/change-role-form';
import { InlineActionForm } from '@/components/forms/inline-action-form';
import { InviteMemberForm } from '@/components/forms/invite-member-form';
import { formatDate, formatDateTime } from '@/lib/format';
import { loadOrgScope } from '@/server/org';
import { removeMember, revokeInvitation } from './actions';

export const metadata: Metadata = { title: 'Equipe' };

/** Do menor para o maior privilégio: o papel mais poderoso nunca é o primeiro da lista. */
const ROLES_BY_PRIVILEGE: readonly Role[] = [...ROLES].reverse();

function displayName(member: Member): string {
  return member.fullName ?? member.email ?? 'Sem nome';
}

export default async function TeamPage({ params }: PageProps<'/o/[slug]/configuracoes/equipe'>) {
  const { slug } = await params;
  const { user, org, ctx, services } = await loadOrgScope(slug);
  const canManage = canManageMembers(org.role);
  const [members, invitations] = await Promise.all([
    services.tenancy.listMembers(ctx, org.id),
    canManage ? services.tenancy.listInvitations(ctx, org.id) : Promise.resolve([]),
  ]);
  const invitableRoles = INVITABLE_ROLES.filter((role) => checkInvitation(org.role, role).ok);

  function assignableRoles(member: Member): Role[] {
    const isSelf = member.userId === user.id;
    return ROLES_BY_PRIVILEGE.filter(
      (role) =>
        role !== member.role &&
        checkRoleChange({ actorRole: org.role, isSelf, targetRole: member.role, newRole: role }).ok,
    );
  }

  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <Link
          href={`/o/${org.slug}/configuracoes`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Configuração
        </Link>
        <h1 className="text-4xl">Equipe</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Proprietários e administradores gerenciam a equipe. Operadores executam o trabalho;
          leitores só consultam. Toda mudança fica registrada na auditoria.
        </p>
      </div>

      <section aria-labelledby="membros" className="space-y-4">
        <h2 id="membros" className="text-2xl">
          Membros <span className="text-base text-muted-foreground">({members.length})</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Pessoa
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Papel
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Desde
                </th>
                {canManage ? (
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => {
                const isSelf = member.userId === user.id;
                const roles = assignableRoles(member);
                const canRemove = checkMemberRemoval({
                  actorRole: org.role,
                  isSelf,
                  targetRole: member.role,
                }).ok;
                const name = displayName(member);
                return (
                  <tr key={member.userId} className="align-top">
                    <td className="py-3 pr-4">
                      <span className="font-medium">{name}</span>
                      {isSelf ? (
                        <Badge variant="outline" className="ml-2">
                          você
                        </Badge>
                      ) : null}
                      {member.fullName && member.email ? (
                        <span className="block text-muted-foreground">{member.email}</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">{ROLE_LABELS[member.role]}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatDate(member.joinedAt)}
                    </td>
                    {canManage ? (
                      <td className="space-y-2 py-3">
                        {roles.length > 0 ? (
                          <ChangeRoleForm
                            orgId={org.id}
                            userId={member.userId}
                            memberName={name}
                            roles={roles}
                          />
                        ) : null}
                        {canRemove ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              Remover da organização…
                            </summary>
                            <InlineActionForm
                              action={removeMember}
                              label={`Remover ${name}`}
                              className="mt-2"
                            >
                              <input type="hidden" name="orgId" value={org.id} />
                              <input type="hidden" name="userId" value={member.userId} />
                              <span className="text-xs text-muted-foreground">
                                Perde o acesso imediatamente.
                              </span>
                              <Button type="submit" size="sm" variant="destructive">
                                Confirmar remoção
                              </Button>
                            </InlineActionForm>
                          </details>
                        ) : null}
                        {roles.length === 0 && !canRemove ? (
                          <span className="text-xs text-muted-foreground">
                            {isSelf
                              ? 'Seu próprio papel é alterado por outro administrador.'
                              : 'Somente proprietários alteram este membro.'}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage ? (
        <>
          <section aria-labelledby="convidar" className="space-y-4">
            <h2 id="convidar" className="text-2xl">
              Convidar
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              O convite gera um link de uso único, válido por 7 dias, que só funciona para a conta
              com o e-mail convidado. O envio automático por e-mail ainda não existe: compartilhe o
              link diretamente.
            </p>
            <InviteMemberForm orgId={org.id} roles={invitableRoles} />
          </section>

          <section aria-labelledby="pendentes" className="space-y-4">
            <h2 id="pendentes" className="text-2xl">
              Convites pendentes
            </h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
            ) : (
              <ul className="divide-y border-y">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">{invitation.email}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {ROLE_LABELS[invitation.role]}
                      </span>
                      {invitation.status === 'expired' ? (
                        <Badge variant="outline" className="ml-2">
                          Expirado
                        </Badge>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {invitation.status === 'expired'
                          ? `Expirou em ${formatDateTime(invitation.expiresAt)}. Revogue e crie um novo convite.`
                          : `Expira em ${formatDateTime(invitation.expiresAt)}`}
                      </span>
                    </span>
                    <InlineActionForm
                      action={revokeInvitation}
                      label={`Revogar convite de ${invitation.email}`}
                    >
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <Button type="submit" size="sm" variant="destructive">
                        Revogar
                      </Button>
                    </InlineActionForm>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
