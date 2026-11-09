import { ROLE_LABELS } from '@prospector/contracts';
import { DemoBadge } from '@prospector/ui';
import { NavLink } from '@/components/nav-link';
import { UserMenu } from '@/components/user-menu';
import { Wordmark } from '@/components/wordmark';
import { MODULES } from '@/lib/modules';
import { loadOrgScope } from '@/server/org';

export default async function OrganizationLayout({ children, params }: LayoutProps<'/o/[slug]'>) {
  const { slug } = await params;
  const { user, org } = await loadOrgScope(slug);
  const base = `/o/${org.slug}`;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="space-y-4 px-5 py-5">
          <Wordmark />
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-serif text-lg leading-tight">
              {org.name}
              {org.isDemo ? <DemoBadge /> : null}
            </p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[org.role]}</p>
          </div>
        </div>
        <nav aria-label="Principal" className="px-3 pb-4">
          <ul className="flex gap-1 overflow-x-auto p-1 md:flex-col md:overflow-visible">
            {MODULES.map((item) => (
              <li key={item.segment} className="shrink-0">
                <NavLink
                  href={item.segment ? `${base}/${item.segment}` : base}
                  exact={!item.segment}
                >
                  <span>{item.label}</span>
                  {item.plannedSlice ? (
                    <span className="text-[0.6875rem] text-muted-foreground">Em breve</span>
                  ) : null}
                </NavLink>
              </li>
            ))}
            <li className="shrink-0 md:mt-4 md:border-t md:pt-4">
              <NavLink href={`${base}/configuracoes`}>Configuração</NavLink>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex justify-end border-b px-6 py-3 sm:px-10">
          <UserMenu email={user.email} />
        </header>
        <main id="conteudo" className="w-full max-w-5xl flex-1 px-6 py-10 sm:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
