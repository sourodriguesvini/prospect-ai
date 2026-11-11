/**
 * Menu lateral recolhido ou expandido. Fica num cookie lido no servidor, para a página já vir
 * no estado certo e não piscar ao carregar. Só preferência de tela: nada sensível.
 */
export const SIDEBAR_COOKIE = 'sidebar';
export const SIDEBAR_STATES = ['expanded', 'collapsed'] as const;
export type SidebarState = (typeof SIDEBAR_STATES)[number];

/** Um ano, como o cookie do tema. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseSidebar(raw: unknown): SidebarState {
  return raw === 'collapsed' ? 'collapsed' : 'expanded';
}

/** Valor para `document.cookie` (o app roda em http://127.0.0.1: sem `Secure`). */
export function sidebarCookie(state: SidebarState): string {
  return `${SIDEBAR_COOKIE}=${state}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}
