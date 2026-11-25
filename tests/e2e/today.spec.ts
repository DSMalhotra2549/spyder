// Phase 5: the Today page shows exactly what aggregate() computes from the same DB.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { appTexts, statTexts } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, openRuns, seed, shot } from './helpers';

const DATE = '2026-11-24';

async function expected(dataDir: string, nowMs: number) {
  const db = new Db(join(dataDir, 'spyder.db'));
  try {
    return dayVM(db, DATE, nowMs, loadSettings(db));
  } finally {
    db.close();
  }
}

const text = (p: Page, id: string) => p.getByTestId(id).innerText();

test('Today matches aggregate(); a category change creates a user rule', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  const s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.openDashboard('today'));
    await d.getByTestId('stat-work').waitFor();
    const nowMs = (await s.debug.state()).now as number;
    const vm = await expected(dir, nowMs);
    expect(vm.summary.sessions.length).toBeGreaterThan(5);
    const t = statTexts(vm.summary, vm.streak);

    // Every number on the stat header.
    expect(await text(d, 'stat-work')).toBe(t.work);
    expect(await text(d, 'stat-work-sub')).toBe(t.workSub);
    expect(await text(d, 'stat-productive')).toBe(t.productive);
    expect(await text(d, 'stat-productive-sub')).toBe(t.productiveSub);
    // P80: productive is the headline; day score is on Review, Week and Month, not here.
    await expect(d.getByTestId('stat-score')).toHaveCount(0);
    expect(await text(d, 'stat-streak')).toBe(t.streak);
    expect(await text(d, 'stat-distractions')).toBe(t.distractions);
    expect(await text(d, 'stat-distractions-sub')).toBe(t.distractionsSub);
    expect(vm.summary.flags.length).toBe(1);
    expect(vm.summary.distractingSec).toBeGreaterThan(0);

    // Top 5 app rows.
    const rows = d.getByTestId('app-row');
    const want = vm.summary.apps.slice(0, 5).map(appTexts);
    expect(want).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const r = rows.nth(i);
      expect({
        key: await r.locator('[data-k=key]').innerText(),
        time: await r.locator('[data-k=time]').innerText(),
        pct: await r.locator('[data-k=pct]').innerText(),
      }).toEqual(want[i]);
    }
    // Only the top 5 show until "Show all"; every block is in the log right under the stats (P55, P64).
    expect(vm.summary.apps.length).toBeGreaterThan(5);
    await expect(rows).toHaveCount(5);
    await openRuns(d);
    await expect(d.getByTestId('block-row')).toHaveCount(vm.summary.sessions.length);
    await d.mouse.move(0, 0);
    await shot(d, 'today');
    await d.getByTestId('apps-show-all').click();
    await expect(rows).toHaveCount(vm.summary.apps.length);
    await d.getByTestId('today').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await d.mouse.move(0, 0);
    await shot(d, 'today-bottom');

    // Change a productive site to Distracting via its chip.
    const target = vm.summary.apps.find((a) => a.category === 'productive' && a.ruleTarget?.matchType === 'domain')!;
    expect(target).toBeTruthy();
    const row = rows.filter({ has: d.locator('[data-k=key]', { hasText: target.key }) });
    await row.getByTestId('category-chip').click();
    await d.locator('[data-category=distracting]').click();
    const after = await expected(dir, nowMs);
    expect(after.summary.distractingSec).toBeGreaterThan(vm.summary.distractingSec);
    await expect(d.getByTestId('stat-distractions-sub')).toHaveText(statTexts(after.summary, after.streak).distractionsSub);
    await expect(row.getByTestId('category-chip')).toContainText('Distracting');
    const rule = s
      .db()
      .prepare('SELECT category, is_default FROM rules WHERE match_type = ? AND pattern = ? AND is_default = 0')
      .get('domain', target.ruleTarget!.pattern) as { category: string } | undefined;
    expect(rule?.category).toBe('distracting');
    await shot(d, 'today-after-rule');
  } finally {
    await s.close();
  }
});
