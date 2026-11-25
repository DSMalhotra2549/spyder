/// <reference lib="dom" />
// Visualizer (P88): today as a 24-hour star clock, drawn from the same data as Today.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { appRuns } from '../../src/core/aggregate';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { freshDataDir, launch, seed, shot } from './helpers';

const DATE = '2026-11-24';

test('Visualizer draws every block and app run of today around the clock', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  const s = await launch({ dataDir: dir, now: `${DATE}T15:00:00` });
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.start(900));
    await d.locator('[data-nav=visualizer]').click();
    await d.getByTestId('visualizer').waitFor();
    await expect(d.locator('h1')).toHaveText('Visualizer');

    const db = new Db(join(dir, 'spyder.db'));
    const vm = (() => {
      try {
        return dayVM(db, DATE, Date.parse(`${DATE}T15:00:00`), loadSettings(db));
      } finally {
        db.close();
      }
    })();
    expect(vm.summary.timeline.segments.length).toBeGreaterThan(5);
    await expect(d.locator('[data-block=viz-session]')).toHaveCount(vm.summary.timeline.segments.length + 1); // + the running block
    await expect(d.locator('[data-block=viz-app]')).toHaveCount(appRuns(vm.summary.timeline.activity).length);
    await expect(d.getByTestId('viz-now')).toBeVisible();

    // The middle shows the bar's block timer, the same as the sidebar.
    await expect.poll(async () => (await d.getByTestId('viz-timer').innerText()) === (await d.getByTestId('sidebar-timer').innerText())).toBe(true);

    // Hovering a block shows its answer.
    await d.locator('[data-block=viz-session]').first().hover();
    await expect(d.locator('[data-testid=visualizer] .rounded-control')).toBeVisible();
    await d.mouse.move(0, 0);
    await shot(d, 'visualizer');
  } finally {
    await s.close();
  }
});
