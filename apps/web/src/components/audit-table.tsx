import type { AuditLogEntry } from '@prospector/contracts';
import { StatusDot } from '@prospector/ui';
import { describeActor, describeAuditEntry } from '@/lib/audit-format';
import { formatDateTime } from '@/lib/format';

/** Tabela de auditoria no padrão da referência: cabeçalho em poço cinza, linhas com fio fino. */
export function AuditTable({ entries }: { entries: readonly AuditLogEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="[&>th]:bg-muted [&>th]:py-3 [&>th]:font-medium [&>th:first-child]:rounded-l-full [&>th:first-child]:pl-4 [&>th:last-child]:rounded-r-full [&>th:last-child]:pr-4">
            <th scope="col">Quando</th>
            <th scope="col">Quem</th>
            <th scope="col">Ação</th>
            <th scope="col">Entidade</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const description = describeAuditEntry(entry);
            return (
              <tr
                key={entry.id}
                className="border-b align-top last:border-b-0 [&>td]:py-3.5 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4"
              >
                <td className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(entry.occurredAt)}
                </td>
                <td>
                  <StatusDot tone={entry.actorType === 'user' ? 'accent' : 'neutral'}>
                    {describeActor(entry)}
                  </StatusDot>
                </td>
                <td className="font-mono text-xs">{description.label}</td>
                <td className="text-muted-foreground">{description.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
