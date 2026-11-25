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
    // The Glass tint slider sets the tint's strength live and keeps it; Reset brings back 55 % (P90).
    await d.getByTestId('set-glassTint').fill('80');
    await expect.poll(() => bg(d, 'body')).toBe('color(srgb 0.0352941 0.0352941 0.0431373 / 0.8)');
    expect(s.db().prepare("SELECT value FROM settings WHERE key = 'glassTint'").get()).toEqual({ value: '80' });
    await shot(d, 'settings-glass-tint');
    await d.getByTestId('reset-glassTint').click();
    await expect.poll(() => bg(d, 'body')).toBe('color(srgb 0.0352941 0.0352941 0.0431373 / 0.55)');
    await expect(d.getByTestId('reset-glassTint')).toHaveCount(0);
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

test("the prompt's glass frame takes the Glass tint, around a solid content card (P92)", async () => {
  const s = await launch();
  try {
    await s.dashboard.evaluate(() => window.spyder.setSettings({ theme: 'dark', glassTint: 80 }));
    await s.dashboard.evaluate(() => window.spyder.start(900));
    await s.debug.advance(900);
    await expect(s.prompt.getByTestId('prompt-account')).toBeVisible();
    await expect.poll(() => bg(s.prompt, 'body')).toBe('color(srgb 0.0352941 0.0352941 0.0431373 / 0.8)');
    expect(await bg(s.prompt, '[data-testid=prompt-account]')).toMatch(/ \/ 0\.97\)$/);
    await shot(s.prompt, 'prompt-glass-tint');
  } finally {
    await s.close();
  }
});

// The computed value of a colour token in a window.
const token = (p: Page, name: string) =>
  p.evaluate((n) => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.color = `var(${n})`;
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

test('the accent colour picked in Settings reaches every window, and Reset brings back Spyder purple (P93)', async () => {
  const s = await launch();
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.setSettings({ theme: 'dark' }));
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    const pick = d.getByTestId('set-accentColor');
    await expect(pick).toHaveValue('#7b61ff');
    await expect(d.getByTestId('reset-accentColor')).toHaveCount(0);

    await pick.fill('#e11d48');
    for (const w of [d, s.widget, s.prompt]) await expect.poll(() => token(w, '--color-accent')).toBe('rgb(225, 29, 72)');
    expect(await token(d, '--color-on-accent')).toBe('rgb(255, 255, 255)');
    expect(s.db().prepare("SELECT value FROM settings WHERE key = 'accentColor'").get()).toEqual({ value: '"#e11d48"' });
    await d.mouse.move(0, 0);
    await d.waitForTimeout(400); // let colour transitions finish
    await shot(d, 'settings-accent');

    // A light accent gets dark text on it.
    await pick.fill('#facc15');
    await expect.poll(() => token(d, '--color-on-accent')).toBe('rgb(17, 17, 20)');

    await d.getByTestId('reset-accentColor').click();
    for (const w of [d, s.widget]) await expect.poll(() => token(w, '--color-accent')).toBe('rgb(123, 97, 255)');
    expect(await token(d, '--color-on-accent')).toBe('rgb(255, 255, 255)');
    await expect(d.getByTestId('reset-accentColor')).toHaveCount(0);
  } finally {
    await s.close();
  }
});
