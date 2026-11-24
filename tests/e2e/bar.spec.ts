// P82: Track from startup on by default, the bar's percent is a setting, one range sets every day's work hours.
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';

type Eng = { loop: { untilStop: boolean } | null };

test('a fresh install tracks from startup and shows % of goal; Every day hours give the workday % (P82, P84)', async () => {
  // No first-run overrides: the real defaults. 2026-11-24 is a Tuesday.
  const s = await launch({ now: '2026-11-24T17:30:00', env: { SPYDER_DEFAULTS: '{}' } });
  try {
    const eng = async () => ((await s.debug.state()).host as { engine: Eng }).engine;
    await expect.poll(async () => (await eng()).loop?.untilStop).toBe(true);
    const cell = s.widget.getByTestId('bar-day');
    await expect(cell).toContainText('0%');
    await expect(cell).toContainText('of goal');
    await shot(s.widget, 'bar-goal-pct');

    const d = s.dashboard;
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    // Default Mon–Fri 10–17, weekends off: Every day is off and the weekday and Today only rows show (P84).
    const toggle = d.getByTestId('sched-all-enabled');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(d.getByTestId('sched-all-start')).toHaveCount(0);
    await expect(d.getByTestId('sched-1')).toBeVisible();
    await expect(d.getByTestId('override')).toBeVisible();

    // On: the weekday rows and Today only collapse; the range starts empty and nothing saves yet.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(d.getByTestId('sched-1')).toHaveCount(0);
    await expect(d.getByTestId('override')).toHaveCount(0);
    await expect(d.getByTestId('sched-all-start')).toHaveValue('');
    expect(s.db().prepare('SELECT COUNT(*) AS n FROM schedule WHERE enabled = 1').get()).toEqual({ n: 5 });

    await d.getByTestId('sched-all-start').fill('11:00');
    await d.getByTestId('sched-all-start').blur();
    expect(s.db().prepare('SELECT COUNT(*) AS n FROM schedule WHERE start_min = 660').get()).toEqual({ n: 0 }); // needs both
    await d.getByTestId('sched-all-end').fill('00:00'); // 12 AM = end of the day
    await d.getByTestId('sched-all-end').blur();
    await expect.poll(() => s.db().prepare('SELECT enabled, start_min, end_min FROM schedule ORDER BY weekday').all()).toEqual(
      Array.from({ length: 7 }, () => ({ enabled: 1, start_min: 660, end_min: 1440 })),
    );
    await expect(d.getByTestId('sched-all-start')).toHaveValue('11:00');
    await shot(d, 'settings-every-day');

    // Off: the days come back, each with the Every day hours; nothing changes.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(d.getByTestId('sched-6-enabled')).toHaveAttribute('aria-checked', 'true');
    await expect(d.getByTestId('sched-6-start')).toHaveValue('11:00');
    await expect(d.getByTestId('override')).toBeVisible();
    await d.waitForTimeout(300); // let the switch finish sliding
    await shot(d, 'settings-every-day-off');
    // A fresh visit shows it on again, since all 7 days still match.
    await d.evaluate(() => window.spyder.openDashboard('today'));
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await expect(d.getByTestId('sched-all-enabled')).toHaveAttribute('aria-checked', 'true');
    await expect(d.getByTestId('sched-1')).toHaveCount(0);
    await toggle.click(); // leave the days showing, as the rest of the test expects nothing here

    await d.getByTestId('set-barPercent').locator('[data-value=day]').click();
    await expect(cell).toContainText('50%'); // 17:30 is 6.5 h into 11:00–24:00
    await expect(cell).toContainText('of day');
    expect(s.db().prepare("SELECT value FROM settings WHERE key = 'barPercent'").get()).toEqual({ value: '"day"' });
    await shot(s.widget, 'bar-day-pct');
  } finally {
    await s.close();
  }
});

test('an install with Track from startup saved off keeps the workday % after the update (P82)', async () => {
  const s = await launch({ env: { SPYDER_DEFAULTS: JSON.stringify({ trackFromStartup: false }) } });
  const dataDir = s.dataDir;
  try {
    s.db().prepare("DELETE FROM settings WHERE key = 'barPercent'").run(); // as before P82
  } finally {
    await s.close();
  }

  const r = await launch({ dataDir, env: { SPYDER_DEFAULTS: '{}' } });
  try {
    await expect(r.widget.getByTestId('bar-day')).toContainText('of day');
    expect(r.db().prepare("SELECT value FROM settings WHERE key IN ('barPercent', 'trackFromStartup') ORDER BY key").all()).toEqual([
      { value: '"day"' },
      { value: 'false' },
    ]);
    expect(((await r.debug.state()).host as { engine: Eng }).engine.loop).toBeNull();
  } finally {
    await r.close();
  }
});
