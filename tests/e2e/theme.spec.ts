/// <reference lib="dom" />
// Theme (P57): Light / Dark / System from Settings, applied live to the dashboard and the bar.
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launch, seed, shot } from './helpers';

const DATE = '2026-11-24';
const bg = (p: Page, sel: string) => p.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
// The dashboard's page is see-through glass, so check the theme's background token the content card is painted with.
const bgToken = (p: Page) =>
  p.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.background = 'var(--color-bg)';
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });

test('theme switches live and covers every page and the bar', async () => {
  const dir = freshDataDir();
  seed(dir, 30, DATE);
  const s = await launch({ dataDir: dir, now: `${DATE}T15:00:00` });
  try {
    const d = s.dashboard;
    // A running loop, so the bar shows its plain surface (Not started is tinted, P59).
    await d.evaluate(() => window.spyder.start(900));
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    const theme = d.getByTestId('set-theme');
    await theme.waitFor();
    await expect(theme.locator('[data-value=system]')).toHaveClass(/bg-surface/); // default (P57)

    await theme.locator('[data-value=light]').click();
    await expect.poll(async () => (await s.debug.state()).theme).toEqual({ source: 'light', dark: false });
    await expect.poll(() => bgToken(d)).toBe('rgb(255, 255, 255)');
    // The glass frame is tinted with the sidebar colour at 55 % (P89): frost in light, charcoal in dark.
    expect(await bg(d, 'body')).toBe('color(srgb 0.968627 0.968627 0.972549 / 0.55)');
    await expect.poll(() => bg(s.widget, '[data-testid=pill]')).toBe('rgb(255, 255, 255)');
    expect(s.db().prepare("SELECT value FROM settings WHERE key = 'theme'").get()).toEqual({ value: '"light"' });

    const pages = ['today', 'review', 'week', 'month', 'rules', 'settings'];
    for (const p of pages) {
      await d.evaluate((r) => window.spyder.openDashboard(r), p);
      await d.locator(`[data-nav=${p}]`).waitFor();
      await d.waitForTimeout(400);
      await d.mouse.move(0, 0);
      await shot(d, `light-${p}`);
    }
    await shot(s.widget, 'light-widget-bar');

    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await theme.locator('[data-value=dark]').click();
    await expect.poll(async () => (await s.debug.state()).theme).toEqual({ source: 'dark', dark: true });
    await expect.poll(() => bgToken(d)).toBe('rgb(14, 14, 16)');
    expect(await bg(d, 'body')).toBe('color(srgb 0.0352941 0.0352941 0.0431373 / 0.55)');
    for (const p of pages) {
      await d.evaluate((r) => window.spyder.openDashboard(r), p);
      await d.waitForTimeout(400);
      await d.mouse.move(0, 0);
      await shot(d, `dark-${p}`);
    }
    await shot(s.widget, 'dark-widget-bar');

    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await theme.locator('[data-value=system]').click();
    await expect.poll(async () => ((await s.debug.state()).theme as { source: string }).source).toBe('system');
  } finally {
    await s.close();
  }
});
