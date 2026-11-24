// P76: Track from startup — the loop starts by itself. (The bar's percent is its own setting since P82, bar.spec.ts.)
import { expect, test } from '@playwright/test';
import { launch } from './helpers';

type Eng = { loop: { untilStop: boolean } | null; reminder: boolean };

test('Track from startup starts the loop at once and on every launch (P76)', async () => {
  const s = await launch({ now: '2026-11-24T08:00:00' }); // before work hours
  const dataDir = s.dataDir;
  try {
    const eng = async () => ((await s.debug.state()).host as { engine: Eng }).engine;
    expect((await eng()).loop).toBeNull();
    await expect(s.widget.getByTestId('bar-day')).toContainText('of day');

    const d = s.dashboard;
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await d.getByTestId('set-trackFromStartup').click();
    await expect.poll(async () => (await eng()).loop?.untilStop).toBe(true);
    await expect(s.widget.getByTestId('pill')).toHaveAttribute('data-state', 'running');
    await expect(s.widget.getByTestId('bar-day')).toContainText('0%');
    await expect(s.widget.getByTestId('bar-day')).toContainText('of day'); // P82: the bar percent doesn't follow it
  } finally {
    await s.close();
  }

  // A later launch (a minute's grace passed: a fresh start) starts the loop with no Start press.
  const r = await launch({ now: '2026-11-24T11:00:00', dataDir });
  try {
    const eng = async () => ((await r.debug.state()).host as { engine: Eng }).engine;
    await expect.poll(async () => (await eng()).loop?.untilStop).toBe(true);
    expect((await eng()).reminder).toBe(false);
  } finally {
    await r.close();
  }
});
