import { cn } from '@prospector/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cookies } from 'next/headers';
import { setTheme } from '@/app/actions';
import { THEME_COOKIE, THEME_LABELS, THEMES, parseTheme, type Theme } from '@/lib/theme';

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

/**
 * Troca de tema por formulário (funciona sem JavaScript, persiste em cookie). Pílula vertical
 * de ícones no topo do trilho, como na referência; em telas estreitas fica na horizontal.
 */
export async function ThemeSwitcher({ className }: { className?: string }) {
  const current = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <form
      action={setTheme}
      aria-label="Tema da interface"
      className={cn('flex gap-1 rounded-full bg-surface p-1 md:flex-col', className)}
    >
      {ORDER.filter((theme) => THEMES.includes(theme)).map((theme) => {
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
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </form>
  );
}
