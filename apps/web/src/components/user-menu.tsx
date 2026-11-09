import { signOut } from '@/app/actions';
import { ThemeSwitcher } from '@/components/theme-switcher';

export function UserMenu({ email }: { email: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <ThemeSwitcher />
      {email ? <span className="text-muted-foreground">{email}</span> : null}
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Sair
        </button>
      </form>
    </div>
  );
}
