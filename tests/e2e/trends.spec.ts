// Phase 6: Week and Month pages over 60 seeded days; week bar totals equal daySummary sums.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { dur } from '../../src/renderer/dashboard/stats';
import { dayLite, monthDates, weekDates } from '../../src/core/trends';
import { Db } from '../../src/main/db/db';
import { summaryFor } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { rangeTexts } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, seed, shot } from './helpers';

const TODAY = '2026-11-24';

function summaries(dataDir: string, dates: string[], nowMs: number) {
  const db = new Db(join(dataDir, 'spyder.db'));
  try {
    const st = loadSettings(db);
    return dates.map((d) => summaryFor(db, d, nowMs, st));
  } finally {
    db.close();
  }
}

test('Week and Month render from 60 seeded days', async () => {
  test.setTimeout(120_000);
  const dir = freshDataDir();
  seed(dir, 60, TODAY);
  const s = await launch({ dataDir: dir, now: `${TODAY}T18:00:00` });
  try {
    const d = s.dashboard;
    const nowMs = (await s.debug.state()).now as number;

    // ---- Week ----
    await d.evaluate(() => window.spyder.openDashboard('week'));
    await d.getByTestId('week-bars').waitFor();
    await expect(d.getByTestId('week-total').first()).toBeAttached();
    const week = weekDates(TODAY);
    const sums = summaries(dir, week, nowMs);
    const lites = sums.map((x) => dayLite(x, TODAY));

    // Every day up to today has a bar total equal to the daySummary sums (work + break + away).
    const want = Object.fromEntries(
      sums
        .filter((x) => x.date <= TODAY)
        .map((x) => [x.date, x.workSec + x.breakSec + x.notWorkingSec + x.awayPendingSec] as const)
        .filter(([, t]) => t > 0)
        .map(([date, t]) => [date, dur(t)]),
    );
    expect(Object.keys(want).length).toBeGreaterThanOrEqual(2); // Mon and Tue are seeded workdays
    const totals = d.getByTestId('week-total');
    const got: Record<string, string> = {};
    for (let i = 0; i < (await totals.count()); i++) {
      const t = totals.nth(i);
      const text = ((await t.locator('text').first().textContent()) ?? '').trim();
      if (text) got[(await t.getAttribute('data-date'))!] = text;
    }
    expect(got).toEqual(want);
    await expect(d.getByTestId('goal-hit')).toHaveCount(
      sums.filter((x) => x.date <= TODAY && x.window && x.goalMet).length,
    );

    const rt = rangeTexts(lites);
    expect(await d.getByTestId('range-work').innerText()).toBe(rt.work);
    expect(await d.getByTestId('range-productive').innerText()).toBe(rt.productive);
    expect(await d.getByTestId('range-score').innerText()).toBe(rt.score);
    expect(await d.getByTestId('range-goals').innerText()).toBe(rt.goals);
    await d.mouse.move(0, 0);
    await shot(d, 'week');

    // The previous week (fully seeded) also renders.
    await d.getByRole('button', { name: 'Previous week' }).click();
    await expect(d.getByTestId('date-label')).toHaveText('Nov 16 – Nov 22 2026');
    await expect(d.getByTestId('goal-hit').first()).toBeAttached();
    await shot(d, 'week-previous');

    // ---- Month ----
    await d.evaluate(() => window.spyder.openDashboard('month'));
    await d.getByTestId('heatmap').waitFor();
    const month = monthDates(TODAY);
    await expect(d.getByTestId('heat-cell')).toHaveCount(month.length);
    const msums = summaries(dir, month, nowMs);
    const metDates = msums.filter((x) => x.date <= TODAY && x.goalMet).map((x) => x.date);
    expect(metDates.length).toBeGreaterThan(5);
    const goalCells = await d
      .locator('[data-testid=heat-cell][data-goal="1"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-date')));
    expect(goalCells).toEqual(metDates);
    await expect(d.getByTestId('trend-productive').locator('.recharts-line')).toHaveCount(1);
    await expect(d.getByTestId('kpi-chart')).toHaveCount(2);
    await d.mouse.move(0, 0);
    await shot(d, 'month');
    await d.getByTestId('month').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(d, 'month-bottom');
  } finally {
    await s.close();
  }
});
