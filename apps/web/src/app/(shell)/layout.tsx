import { Laptop, Settings } from 'lucide-react';
import { NavIcon, NavPill } from '@/components/nav-link';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Wordmark } from '@/components/wordmark';
import { MODULES, moduleHref } from '@/lib/modules';

const TOP = MODULES.filter((item) => item.placement === 'top');
const RAIL = MODULES.filter((item) => item.placement === 'rail');

function railLabel(label: string, plannedSlice: string | null): string {
  return plannedSlice ? `${label} (em breve)` : label;
}

/**
 * Moldura do app (design system, docs/07 §5): moldura cinza arredondada sobre o fundo,
 * barra superior com marca, navegação em pílula e indicação de uso local; trilho de ícones
 * à esquerda com tema, módulos de apoio e configuração.
 */
export default function ShellLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="min-h-dvh p-2 sm:p-3">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col gap-4 rounded-[2rem] bg-background p-3 sm:min-h-[calc(100dvh-1.5rem)] sm:p-4">
        <header className="flex flex-wrap items-center gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div className="lg:justify-self-start">
            <Wordmark />
          </div>
          <nav
            aria-label="Principal"
            className="order-3 w-full overflow-x-auto rounded-full bg-surface p-1 lg:order-none lg:w-auto"
          >
            <ul className="flex gap-1">
              {TOP.map((item) => (
                <li key={item.segment} className="shrink-0">
                  <NavPill href={moduleHref(item)} exact={!item.segment}>
                    {item.label}
                  </NavPill>
                </li>
              ))}
            </ul>
          </nav>
          <p className="ml-auto hidden h-12 sm:inline-flex items-center gap-2 rounded-full bg-surface px-4 text-sm text-muted-foreground lg:justify-self-end">
            <Laptop aria-hidden="true" className="size-4" />
            Só neste computador
          </p>
        </header>

        <div className="flex flex-1 flex-col gap-4 md:flex-row">
          <aside className="flex gap-2 md:w-12 md:shrink-0 md:flex-col md:justify-between">
            <div className="flex gap-2 md:flex-col">
              <ThemeSwitcher />
              <nav aria-label="Apoio" className="rounded-full bg-surface p-1">
                <ul className="flex gap-1 md:flex-col">
                  {RAIL.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.segment}>
                        <NavIcon
                          href={moduleHref(item)}
                          label={railLabel(item.label, item.plannedSlice)}
                        >
                          <Icon aria-hidden="true" className="size-[18px]" />
                        </NavIcon>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
            <nav aria-label="Sistema" className="ml-auto rounded-full bg-surface p-1 md:ml-0">
              <NavIcon href="/configuracoes" label="Configuração">
                <Settings aria-hidden="true" className="size-[18px]" />
              </NavIcon>
            </nav>
          </aside>

          <main id="conteudo" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
