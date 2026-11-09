'use client';

import { ROLE_LABELS, type Role } from '@prospector/contracts';
import { Button, NativeSelect } from '@prospector/ui';
import { useId, useState } from 'react';
import { changeMemberRole } from '@/app/o/[slug]/configuracoes/equipe/actions';
import { InlineActionForm } from './inline-action-form';

/**
 * Troca de papel de um membro. Começa sem papel escolhido (nunca pré-seleciona um papel
 * diferente do atual) e exige confirmação explícita para conceder "Proprietário"; o servidor
 * reaplica as duas regras.
 */
export function ChangeRoleForm({
  orgId,
  userId,
  memberName,
  roles,
}: {
  orgId: string;
  userId: string;
  memberName: string;
  /** Papéis que o usuário atual pode atribuir, do menor para o maior privilégio. */
  roles: readonly Role[];
}) {
  const [selected, setSelected] = useState('');
  const confirmId = useId();

  return (
    <InlineActionForm action={changeMemberRole} label={`Alterar papel de ${memberName}`}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="userId" value={userId} />
      <NativeSelect
        name="role"
        aria-label={`Novo papel de ${memberName}`}
        className="h-8 w-48"
        value={selected}
        required
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="" disabled>
          Escolha o novo papel…
        </option>
        {roles.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </NativeSelect>
      {selected === 'owner' ? (
        <span className="flex basis-full items-start gap-2 text-xs">
          <input
            id={confirmId}
            type="checkbox"
            name="confirmOwner"
            required
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <label htmlFor={confirmId}>
            Confirmo: {memberName} terá controle total, inclusive para alterar papéis e remover
            outros proprietários.
          </label>
        </span>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" disabled={selected === ''}>
        Alterar papel
      </Button>
    </InlineActionForm>
  );
}
