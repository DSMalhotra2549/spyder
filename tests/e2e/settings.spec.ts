// Phase 6: settings changes apply live (engine, idle detection, schedule).
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';

type Eng = { mode: string; prompts: { type: string }[] };

test('settings apply live: check-in, idle threshold, schedule', async () => {
  const s = await launch(); // Tue 2026-11-24 11:00, an open session auto-starts
  try {
    const d = s.dashboard;
    const eng = async () => ((await s.debug.state()).host as { engine: Eng }).engine;
    await expect.poll(async () => (await eng()).mode).toBe('working');
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await d.getByTestId('settings').waitFor();
    await shot(d, 'settings');
    await d.getByTestId('settings').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(d, 'settings-bottom');
    await d.getByTestId('settings').evaluate((el) => el.scrollTo(0, 0));

    // Check-in every 10 min → the prompt comes at 10 clock-min, not before.
    await d.getByTestId('set-checkInIntervalSec').fill('10');
    await d.getByTestId('set-checkInIntervalSec').press('Enter');
    await expect
      .poll(
        () =>
          (
            s.db().prepare("SELECT value FROM settings WHERE key = 'checkInIntervalSec'").get() as {
              value: string;
            }
          ).value,
      )
      .toBe('600');
    await s.debug.advance(540);
    await s.debug.tick();
    expect((await eng()).prompts.some((p) => p.type === 'checkIn')).toBe(false);
    await s.debug.advance(61);
    await s.debug.tick();
    expect((await eng()).prompts.some((p) => p.type === 'checkIn')).toBe(true);

    // Idle threshold 1 min → last input 70 s ago means away.
    await d.getByTestId('set-idleThresholdSec').fill('1');
    await d.getByTestId('set-idleThresholdSec').press('Enter');
    await expect
      .poll(
        () =>
          (
            s.db().prepare("SELECT value FROM settings WHERE key = 'idleThresholdSec'").get() as {
              value: string;
            }
          ).value,
      )
      .toBe('60');
    const now = (await s.debug.state()).now as number;
    await s.debug.simulateIdle(now - 70_000);
    expect((await eng()).mode).toBe('away');
    await s.debug.simulateIdle(null);
    expect((await eng()).mode).toBe('working');

    // Switching today (Tuesday) off → Off hours right away.
    await d.getByTestId('sched-2-enabled').click();
    await expect.poll(async () => (await eng()).mode).toBe('off_hours');
    await expect(s.widget.getByText('Off hours')).toBeVisible();
    const row = s.db().prepare('SELECT enabled FROM schedule WHERE weekday = 2').get() as { enabled: number };
    expect(row.enabled).toBe(0);
    // The workday ending opens the review (E3), like at 17:00.
    await expect(d.getByRole('button', { name: 'Complete review' })).toBeVisible();
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await expect(d.getByTestId('sched-2-enabled')).toHaveAttribute('aria-checked', 'false');
    await shot(d, 'settings-after');
    // A "today only" override brings work hours back.
    await d.getByTestId('override-enabled').click();
    await expect.poll(async () => (await eng()).mode).toBe('working');
  } finally {
    await s.close();
  }
});
