import { cn } from '@prospector/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cookies } from 'next/headers';
import { setTheme } from '@/app/actions';
import { THEME_COOKIE, THEME_LABELS, THEMES, parseTheme, type Theme } from '@/lib/theme';

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

const button =
  'grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-10';

/**
 * Troca de tema por formulário (funciona sem JavaScript, persiste em cookie), no rodapé do menu
 * lateral. Menu expandido (e gaveta do celular): pílula com os três temas. Menu recolhido: um
 * botão só, que passa para o próximo tema (claro → escuro → sistema), para caber na coluna.
 */
export async function ThemeSwitcher({ className }: { className?: string }) {
  const current = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const themes = ORDER.filter((theme) => THEMES.includes(theme));
  const next = themes[(themes.indexOf(current) + 1) % themes.length] ?? 'light';
  const CurrentIcon = ICONS[current];
  return (
    <form
      action={setTheme}
      aria-label="Tema da interface"
      className={cn('flex shrink-0 gap-0.5 rounded-full bg-muted p-1', className)}
    >
      {themes.map((theme) => {
        const Icon = ICONS[theme];
        return (
          <button
            key={theme}
            type="submit"
            name="theme"
            value={theme}
            aria-label={THEME_LABELS[theme]}
            title={`Tema: ${THEME_LABELS[theme]}`}
            aria-pressed={current === theme}
            className={cn(
              button,
              'aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--shadow-panel)] md:group-data-[collapsed=true]/sidebar:hidden',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
      <button
        type="submit"
        name="theme"
        value={next}
        aria-label={`Tema: ${THEME_LABELS[current]}. Trocar para ${THEME_LABELS[next]}`}
        data-tip={`Tema: ${THEME_LABELS[current]} · trocar para ${THEME_LABELS[next]}`}
        className={cn(
          button,
          'hidden bg-surface text-foreground shadow-[var(--shadow-panel)] md:group-data-[collapsed=true]/sidebar:grid',
        )}
      >
        <CurrentIcon aria-hidden="true" className="size-4" />
      </button>
    </form>
  );
}
