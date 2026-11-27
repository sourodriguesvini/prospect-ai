/**
 * Item de lista com asterisco (`* item`) vira item com hífen (`- item`), que é como a tela mostra
 * listas. Negrito (`**texto**`) não é afetado: o asterisco do item precisa de espaço depois.
 * Determinístico, sem depender do prompt (revisão do avaliador-ia, KI-076 A5).
 */
export function normalizeListMarkers(text: string): string {
  return text.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');
}
