export const THEME_COOKIE = 'theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Escuro',
};

export function parseTheme(raw: unknown): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : 'system';
}
