// Phase 6: a new title pattern re-labels existing Firefox rows; the inbox creates rules.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { freshDataDir, launch, seed, shot } from './helpers';

const DATE = '2026-11-24';
const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).getTime();

function apps(dataDir: string, nowMs: number) {
  const db = new Db(join(dataDir, 'spyder.db'));
  try {
    return dayVM(db, DATE, nowMs, loadSettings(db)).summary.apps;
  } finally {
    db.close();
  }
}

test('title pattern re-labels past Firefox rows; inbox and editors work', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  // Two Firefox pages no pattern knows yet, inside work hours.
  {
    const db = new Db(join(dir, 'spyder.db'));
    for (const [s, e, title] of [
      [at(15, 0), at(15, 12), 'Show HN: A tiny SQL engine | Hacker News'],
      [at(15, 12), at(15, 20), 'Ask HN: What are you working on? | Hacker News'],
    ] as const) {
      db.run(
        "INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, 'firefox.exe', 'Firefox', ?, NULL, 'firefox', 0)",
        s,
        e,
        title,
      );
    }
    db.close();
  }
  const s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  try {
    const d = s.dashboard;
    const nowMs = (await s.debug.state()).now as number;
    const before = apps(dir, nowMs);
    expect(before.filter((a) => a.key.endsWith('| Hacker News')).map((a) => a.key)).toHaveLength(2);
    // The seed has Chrome visits to the site already.
    const hnBefore = before.find((a) => a.key === 'news.ycombinator.com')?.sec ?? 0;

    // Add the pattern on the Rules page.
    await d.evaluate(() => window.spyder.openDashboard('rules'));
    await d.getByTestId('rules-tabs').locator('[data-value=patterns]').click();
    const add = d.getByTestId('pattern-add');
    await add.getByLabel('Match').selectOption('contains');
    await add.getByLabel('Title pattern').fill('Hacker News');
    await add.getByLabel('Domain').fill('news.ycombinator.com');
    await add.getByRole('button', { name: '+ Add pattern' }).click();
    await expect(d.getByTestId('pattern-row').first().getByLabel('Domain')).toHaveValue(
      'news.ycombinator.com',
    );
    await shot(d, 'rules-patterns');

    // Reports now count both pages (20 min) under the domain.
    const after = apps(dir, nowMs);
    expect(after.some((a) => a.key.endsWith('| Hacker News'))).toBe(false);
    expect(after.find((a) => a.key === 'news.ycombinator.com')?.sec).toBe(hnBefore + 20 * 60);
    await d.evaluate(() => window.spyder.openDashboard('today'));
    await d.getByTestId('apps-show-all').click(); // the block seed spreads time over more sites than the top 5
    await expect(d.getByTestId('app-row').filter({ hasText: 'news.ycombinator.com' })).toHaveCount(1);
    await expect(d.getByTestId('app-row').filter({ hasText: 'Hacker News' })).toHaveCount(0);

    // The site has no rule yet → it is in the Uncategorized inbox; one click files it.
    await d.evaluate(() => window.spyder.openDashboard('rules'));
    await d.getByTestId('rules-tabs').locator('[data-value=inbox]').click();
    const row = d.getByTestId('inbox-row').filter({ hasText: 'news.ycombinator.com' });
    await expect(row).toHaveCount(1);
    await shot(d, 'rules-inbox');
    await row.locator('[data-category=distracting]').click();
    await expect(row).toHaveCount(0);
    expect(apps(dir, nowMs).find((a) => a.key === 'news.ycombinator.com')?.category).toBe('distracting');

    // Rules tab lists the new user rule; changing a default's category creates a user rule.
    await d.getByTestId('rules-tabs').locator('[data-value=rules]').click();
    await d.getByLabel('Filter rules').fill('ycombinator');
    await expect(d.getByTestId('rule-row')).toHaveCount(1);
    await d.getByLabel('Filter rules').fill('reddit.com');
    await d.getByTestId('rule-row').getByLabel('Category').selectOption('neutral');
    await expect(d.getByTestId('rule-row')).toHaveCount(1);
    await expect(d.getByTestId('rule-row')).not.toContainText('default');
    const rr = s
      .db()
      .prepare("SELECT category FROM rules WHERE pattern = 'reddit.com' AND is_default = 0")
      .get() as { category: string };
    expect(rr.category).toBe('neutral');
    await d.getByTestId('rule-row').getByRole('button', { name: 'Delete rule' }).click();
    await expect(d.getByTestId('rule-row')).toContainText('default');
    await d.getByLabel('Filter rules').fill('');
    await shot(d, 'rules');

    // KPIs moved to Review (P80): no tab for them here.
    await expect(d.getByTestId('rules-tabs').locator('[data-value=kpis]')).toHaveCount(0);
  } finally {
    await s.close();
  }
});
