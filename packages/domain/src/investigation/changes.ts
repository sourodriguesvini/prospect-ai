import type { InvestigationChange, InvestigationSnapshot } from '@prospector/contracts';

/**
 * O que mudou desde a investigação anterior (§16 da especificação), em texto do sistema. Falha
 * de acesso nesta coleta vira `temporarily_unavailable` e não é tratada como mudança definitiva:
 * página que não respondeu não "sumiu", e site fora do ar não "mudou".
 */

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function list(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max).map((item) => `"${item}"`);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} e mais ${rest}` : shown.join(', ');
}

function added(previous: readonly string[], current: readonly string[]): string[] {
  const before = new Set(previous.map(fold));
  return current.filter((item) => !before.has(fold(item)));
}

function cut(text: string): string {
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

export function detectChanges(
  previous: InvestigationSnapshot | null,
  current: InvestigationSnapshot,
): InvestigationChange[] {
  if (previous === null) return [];
  const changes: InvestigationChange[] = [];
  const push = (kind: InvestigationChange['kind'], text: string) =>
    changes.push({ kind, text: cut(text), claimIds: [] });

  if (current.siteReachable === false) {
    push(
      'temporarily_unavailable',
      'O site não respondeu nesta coleta. Nada foi concluído a partir disso; a comparação de páginas e visual fica para a próxima investigação.',
    );
  } else if (previous.siteUrl && current.siteUrl && previous.siteUrl !== current.siteUrl) {
    push(
      'site_changed',
      `O site considerado oficial mudou de ${previous.siteUrl} para ${current.siteUrl}.`,
    );
  }

  if (current.siteReachable !== false) {
    const prevPages = new Map(previous.pages.map((page) => [page.url, page]));
    const curPages = new Map(current.pages.map((page) => [page.url, page]));
    const newPages = current.pages.filter((page) => page.ok && !prevPages.has(page.url));
    if (newPages.length > 0) {
      push(
        'page_added',
        `Página nova lida no site: ${list(
          newPages.map((page) => page.url),
          2,
        )}.`,
      );
    }
    const missing = previous.pages.filter((page) => page.ok && !curPages.has(page.url));
    if (missing.length > 0) {
      push(
        'page_missing',
        `Página da coleta anterior não apareceu no menu desta vez: ${list(
          missing.map((page) => page.url),
          2,
        )}.`,
      );
    }
    const failing = current.pages.filter((page) => !page.ok && prevPages.get(page.url)?.ok);
    if (failing.length > 0) {
      push(
        'temporarily_unavailable',
        `Página que respondia antes não respondeu agora: ${list(
          failing.map((page) => page.url),
          2,
        )}. Pode ser temporário.`,
      );
    }

    const newOfferings = added(previous.offerings, current.offerings);
    if (newOfferings.length > 0 && previous.offerings.length > 0) {
      push('offering_added', `Oferta nova no site: ${list(newOfferings)}.`);
    }
    const gone = added(current.offerings, previous.offerings);
    if (gone.length > 0 && current.offerings.length > 0) {
      push('offering_missing', `Oferta da coleta anterior não apareceu desta vez: ${list(gone)}.`);
    }
    if (
      previous.valueProposition &&
      current.valueProposition &&
      fold(previous.valueProposition) !== fold(current.valueProposition)
    ) {
      push(
        'communication_changed',
        'A proposta de valor comunicada no site mudou desde a última investigação.',
      );
    }

    const visual: string[] = [];
    if (
      previous.fonts.length > 0 &&
      current.fonts.length > 0 &&
      fold(previous.fonts[0] ?? '') !== fold(current.fonts[0] ?? '')
    ) {
      visual.push(`fonte principal de ${previous.fonts[0]} para ${current.fonts[0]}`);
    }
    const newColors = added(previous.colors, current.colors);
    if (previous.colors.length > 0 && newColors.length >= Math.max(2, current.colors.length / 2)) {
      visual.push(`cores novas (${newColors.slice(0, 3).join(', ')})`);
    }
    if (visual.length > 0) {
      push('visual_changed', `A identidade visual do site mudou: ${visual.join('; ')}.`);
    }
  }

  const newSignals = added(previous.signals, current.signals);
  if (newSignals.length > 0) push('new_signal', `Sinal novo: ${list(newSignals)}.`);
  const newCompetitors = added(previous.competitors, current.competitors);
  if (newCompetitors.length > 0) {
    push('competitor_added', `Concorrente novo encontrado: ${list(newCompetitors)}.`);
  }
  return changes.slice(0, 30);
}
