import { describe, expect, it } from 'vitest';
import { parseSidebar, sidebarCookie } from './sidebar';

describe('cookie do menu lateral', () => {
  it('só "collapsed" recolhe; qualquer outro valor deixa expandido', () => {
    expect(parseSidebar('collapsed')).toBe('collapsed');
    expect(parseSidebar('expanded')).toBe('expanded');
    expect(parseSidebar(undefined)).toBe('expanded');
    expect(parseSidebar('qualquer')).toBe('expanded');
  });

  it('vale para o app todo por um ano, sem ir para outros sites', () => {
    expect(sidebarCookie('collapsed')).toBe(
      'sidebar=collapsed; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });
});
