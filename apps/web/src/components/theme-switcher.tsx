import { cookies } from 'next/headers';
import { setTheme } from '@/app/actions';
import { THEME_COOKIE, THEME_LABELS, THEMES, parseTheme } from '@/lib/theme';

/** Troca de tema por formulário: funciona sem JavaScript e persiste em cookie. */
export async function ThemeSwitcher() {
  const current = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <form
      action={setTheme}
      className="inline-flex items-center gap-1 text-xs"
      aria-label="Tema da interface"
    >
      <span className="mr-1 text-muted-foreground">Tema</span>
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="submit"
          name="theme"
          value={theme}
          aria-pressed={current === theme}
          className="rounded-sm px-1.5 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:underline aria-pressed:decoration-primary aria-pressed:decoration-2 aria-pressed:underline-offset-4"
        >
          {THEME_LABELS[theme]}
        </button>
      ))}
    </form>
  );
}
