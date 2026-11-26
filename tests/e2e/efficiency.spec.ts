/// <reference lib="dom" />
// Efficiency (P75): rated in the prompt, shown and changed on Today (with Undo), kept as the mean by a merge, and
// summed on Review, Week and Month.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM, rangeVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { weekDates } from '../../src/core/trends';
import { rangeTexts, statTexts } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, openRuns, shot, type Launched } from './helpers';

const DATE = '2026-11-24';

function withDb<T>(dir: string, fn: (db: Db) => T): T {
  const db = new Db(join(dir, 'spyder.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

test('rate in the prompt, change on Today with Undo, merge keeps the mean, totals everywhere (P75)', async () => {
  const dir = freshDataDir();
  s = await launch({ dataDir: dir });
  const p = s.prompt;
  const eff = (name: string) => s!.db().prepare('SELECT efficiency AS e FROM sessions WHERE name = ? AND deleted_ms IS NULL ORDER BY started_ms').all(name).map((r) => (r as { e: number | null }).e);

  // Three blocks: Deck at 50%, Deck at 100%, Emails not rated.
  await p.getByTestId('reminder-start').click();
  const answer = async (text: string, rate: number | null) => {
    await s!.debug.advance(900);
    await expect(p.getByTestId('prompt-account')).toBeVisible();
    await p.getByLabel('Answer').fill(text);
    if (rate !== null) await p.getByTestId('account-efficiency').locator(`[data-value="${rate}"]`).click();
    if (rate === 50) {
      await expect(p.getByTestId('account-efficiency').locator('[aria-pressed=true]')).toHaveText('50%');
      await shot(p, 'prompt-efficiency');
    }
    await p.getByTestId('account-save').click();
    await expect(p.getByTestId('prompt-account')).toBeHidden();
  };
  await answer('Deck', 50);
  await answer('Deck', 100);
  await answer('Emails', null);
  expect(eff('Deck')).toEqual([50, 100]);
  expect(eff('Emails')).toEqual([null]);

  // A rating picked and then clicked again is cleared; Break never stores one.
  await s.debug.advance(900);
  await p.getByLabel('Answer').fill('Nap');
  const picker = p.getByTestId('account-efficiency');
  await picker.locator('[data-value="75"]').click();
  await picker.locator('[data-value="75"]').click();
  await expect(picker.locator('[aria-pressed=true]')).toHaveCount(0);
  await picker.locator('[data-value="25"]').click();
  await p.getByTestId('account-break').click();
  await expect(p.getByTestId('prompt-account')).toBeHidden();
  expect(eff('Nap')).toEqual([null]);

  // Today: the stat cell matches aggregate(), from the same DB.
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  const nowMs = (await s.debug.state()).now as number;
  const check = async () => {
    const vm = withDb(dir, (db) => dayVM(db, DATE, nowMs, loadSettings(db)));
    const t = statTexts(vm.summary, vm.streak);
    await expect(d.getByTestId('stat-efficiency')).toHaveText(t.efficiency);
    await expect(d.getByTestId('stat-efficiency-sub')).toHaveText(t.efficiencySub);
    return vm.summary;
  };
  const s0 = await check();
  expect(s0.efficiency).toBeCloseTo(0.75, 2);
  await expect(d.getByTestId('stat-efficiency')).toHaveText('75%');

  // Each work block has its own dropdown; the break and the running block can't be rated.
  const row = (name: string) => d.getByTestId('block-row').filter({ has: d.getByTestId('block-answer').getByText(name, { exact: true }) });
  await expect(row('Deck').first().getByTestId('block-efficiency')).toHaveValue('50');
  await expect(row('Emails').getByTestId('block-efficiency')).toHaveValue('none');
  await expect(row('Nap').getByTestId('block-efficiency')).toHaveCount(0);
  const running = d.locator('[data-testid=block-row]').last();
  await expect(running.getByTestId('block-efficiency')).toBeDisabled();
  await d.mouse.move(0, 0);
  await shot(d, 'today-efficiency');

  // Change one on Today; Undo puts it back.
  await row('Emails').getByTestId('block-efficiency').selectOption('25');
  await expect(d.getByTestId('toast')).toContainText('“Emails” is 25% efficient');
  expect(eff('Emails')).toEqual([25]);
  await check();
  await d.getByTestId('toast-undo').click();
  await expect(row('Emails').getByTestId('block-efficiency')).toHaveValue('none');
  expect(eff('Emails')).toEqual([null]);

  // Rate… on selected blocks.
  await row('Emails').getByTestId('block-check').click();
  await d.getByTestId('rate-selected').selectOption('100');
  await expect(d.getByTestId('toast')).toContainText('“Emails” is 100% efficient');
  expect(eff('Emails')).toEqual([100]);

  // Merging the two Deck blocks keeps the time-weighted mean: 50% and 100% over equal time → 75%.
  for (const r of await row('Deck').all()) await r.getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await d.getByTestId('panel-save').click();
  await expect(row('Deck')).toHaveCount(1);
  expect(eff('Deck')).toEqual([75]);
  await expect(row('Deck').getByTestId('block-efficiency')).toHaveValue('75');
  const s1 = await check();
  // Every ended work block is rated now.
  expect(s1.ratedSec).toBe(s1.sessions.filter((x) => x.tag === 'work' && !x.running).reduce((t, x) => t + x.daySec, 0));
  await d.getByTestId('toast-undo').click();
  await expect(row('Deck')).toHaveCount(2);
  expect(eff('Deck')).toEqual([50, 100]);

  // Tagged a break, a block loses its rating, so tagged Work again it isn't rated.
  await row('Emails').getByTestId('block-tag').selectOption('break');
  await expect.poll(() => eff('Emails')).toEqual([null]);
  await row('Emails').getByTestId('block-tag').selectOption('work');
  await expect(row('Emails').getByTestId('block-efficiency')).toHaveValue('none');
  await d.getByTestId('toast').getByLabel('Dismiss').click();

  // Review shows it with the effective time.
  await d.evaluate(() => window.spyder.openDashboard('review'));
  const rv = withDb(dir, (db) => dayVM(db, DATE, nowMs, loadSettings(db))).summary;
  await expect(d.getByTestId('review-efficiency')).toHaveText(`${Math.round(rv.efficiency! * 100)}%`);

  // Week: the stat matches rangeTexts(); Month: the efficiency trend has a point.
  await d.evaluate(() => window.spyder.openDashboard('week'));
  const w = weekDates(DATE);
  const rt = rangeTexts(withDb(dir, (db) => rangeVM(db, w[0], w[6], nowMs, loadSettings(db))).days);
  await expect(d.getByTestId('range-efficiency')).toHaveText(rt.efficiency);
  await expect(d.getByTestId('range-efficiency-sub')).toHaveText(rt.efficiencySub);
  await expect(d.getByTestId('trend-efficiency')).toBeVisible();
  await d.mouse.move(0, 0);
  await shot(d, 'week-efficiency');
  await d.evaluate(() => window.spyder.openDashboard('month'));
  await expect(d.getByTestId('trend-efficiency')).toBeVisible();
});
