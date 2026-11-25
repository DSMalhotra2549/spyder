/// <reference lib="dom" />
// P102: Today at a glance: stat tile icons, the running ping, collapsed runs, no `—` on unrated blocks until hover,
// `1h 26m` durations and each app's own icon in Apps & sites.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { alikeRuns, dayLog } from '../../src/core/aggregate';
import { dur } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, seed, shot } from './helpers';

const DATE = '2026-11-24';

function expected(dataDir: string, nowMs: number) {
  const db = new Db(join(dataDir, 'spyder.db'));
  try {
    return dayVM(db, DATE, nowMs, loadSettings(db));
  } finally {
    db.close();
  }
}

test('Today at a glance (P102)', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  const s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  try {
    const d = s.dashboard;
    // The app with the most time ran from a known program file (as if capture had seen it).
    const nowMs0 = (await s.debug.state()).now as number;
    const top = expected(dir, nowMs0).summary.apps[0];
    await s.debug.rememberAppPath(top.exe, process.execPath);
    await d.evaluate(() => window.spyder.openDashboard('today'));
    await d.getByTestId('block-log').waitFor();
    await d.evaluate(() => window.spyder.start(900)); // a running block
    await expect(d.getByTestId('running-dot')).toBeVisible();
    const nowMs = (await s.debug.state()).now as number;
    const vm = expected(dir, nowMs);

    // Stat tiles carry icons; the flame is lit while the streak is alive.
    for (const k of ['productive', 'work', 'efficiency', 'streak']) await expect(d.getByTestId(`icon-${k}`)).toBeVisible();
    expect(vm.streak).toBeGreaterThan(0);
    await expect(d.getByTestId('icon-streak')).toHaveClass(/text-orange/);

    // The running block's dot pings.
    await expect(d.getByTestId('running-dot').locator('.animate-ping')).toHaveCount(1);

    // Runs start collapsed: one row per run, spanning it, with its total.
    const runs = alikeRuns(dayLog(vm.summary));
    expect(runs.length).toBeGreaterThan(1);
    const hidden = runs.reduce((t, r) => t + r.length - 1, 0);
    const rows = d.getByTestId('block-row');
    await expect(rows).toHaveCount(vm.summary.sessions.length - hidden);
    const code = rows.filter({ hasText: 'Code review' });
    await expect(code).toHaveCount(1);
    await expect(code).toHaveAttribute('data-collapsed', 'true');
    await expect(code).toContainText('12:45–13:30');
    await expect(code.getByTestId('block-dur')).toHaveText('45m');
    await d.mouse.move(0, 0);
    await shot(d, 'today-glance');

    // Ticking a collapsed run ticks all its blocks.
    await code.hover();
    await code.getByTestId('block-check').click();
    await expect(d.getByTestId('selection-bar')).toContainText('3 selected');
    await d.getByRole('button', { name: 'Clear' }).click();

    // Its caption opens it into its blocks, and closes it again.
    await code.getByTestId('block-group').click();
    await expect(rows.filter({ hasText: 'Code review' })).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Code review' }).first().getByTestId('block-group')).toHaveAttribute('aria-expanded', 'true');
    await rows.filter({ hasText: 'Code review' }).first().getByTestId('block-group').click();
    await expect(rows.filter({ hasText: 'Code review' })).toHaveCount(1);

    // Rating a collapsed run rates its blocks; different ratings read `mixed`.
    await code.getByTestId('block-efficiency').selectOption('75');
    await expect(code.getByTestId('block-efficiency')).toHaveValue('75');
    const rated = expected(dir, nowMs).summary.sessions.filter((x) => x.name === 'Code review');
    expect(rated.map((x) => x.efficiency)).toEqual([75, 75, 75]);
    await code.getByTestId('block-group').click();
    await rows.filter({ hasText: 'Code review' }).nth(1).getByTestId('block-efficiency').selectOption('50');
    await rows.filter({ hasText: 'Code review' }).first().getByTestId('block-group').click();
    await expect(code.getByTestId('block-efficiency')).toHaveValue('mixed');

    // An unrated block shows no `—` until its row is hovered.
    const unrated = rows.filter({ hasText: 'Inbox zero' }).getByTestId('block-efficiency');
    await d.mouse.move(0, 0);
    const color = () => unrated.evaluate((el) => getComputedStyle(el).color);
    expect(await color()).toBe('rgba(0, 0, 0, 0)');
    await rows.filter({ hasText: 'Inbox zero' }).hover();
    await expect.poll(color).not.toBe('rgba(0, 0, 0, 0)');

    // Durations read `1h 26m` everywhere, never `1:26`.
    const app = d.getByTestId('app-row').first();
    await expect(app.locator('[data-k=time]')).toHaveText(dur(vm.summary.apps[0].sec));

    // The app's own icon, read from its program file; an app whose file isn't known has none.
    await expect(app).toContainText(top.key);
    await expect(app.getByTestId('app-icon')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const other = vm.summary.apps.slice(0, 5).findIndex((a) => a.exe !== top.exe);
    expect(other).toBeGreaterThan(0);
    await expect(d.getByTestId('app-row').nth(other).getByTestId('app-icon')).toHaveCount(0);
    await d.getByTestId('app-row').first().scrollIntoViewIfNeeded();
    await d.mouse.move(0, 0);
    await shot(d, 'today-app-icons');
  } finally {
    await s.close();
  }
});
