const MAX_SLUG_LENGTH = 48;

/**
 * Sugere um slug a partir do nome ("Estúdio Ação & Cia" → "estudio-acao-cia").
 * O resultado ainda passa pela validação de `OrganizationSlug`; pode ficar curto demais
 * (ex.: nome "A"), e nesse caso a interface pede ajuste manual.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}
