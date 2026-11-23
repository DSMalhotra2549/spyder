/// <reference lib="dom" />
// P70: Spyder asks how each app and site counts: in the end-of-block prompt, and in Rules → To sort
// (all time, pre-labelled ones too). Answering creates the user's own rule, so it isn't asked again.
import { expect, test } from '@playwright/test';
import { launch, shot, type Launched } from './helpers';

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

const MIN = 60_000;
type Host = { engine: { loop: { block: { startedMs: number } } | null } };

test('the prompt asks about apps and sites the block used; To sort lists the rest (P70)', async () => {
  s = await launch({ scale: 1 });
  const d = s.dashboard;
  const p = s.prompt;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('sidebar-start').click();
  await expect.poll(async () => ((await s!.debug.state()).host as Host).engine.loop).not.toBeNull();
  const t0 = ((await s.debug.state()).host as Host).engine.loop!.block.startedMs;

  // In the block: YouTube (default Distracting) 6m, an unknown app 5m, VS Code (default Productive) 3m, a 1m blip.
  const db = s.db();
  const add = (from: number, to: number, exe: string, app: string, domain: string | null, browser: string | null) =>
    db
      .prepare('INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, ?, ?, NULL, ?, ?, 0)')
      .run(t0 + from * MIN, t0 + to * MIN, exe, app, domain, browser);
  add(0, 6, 'chrome.exe', 'Google Chrome', 'youtube.com', 'chrome');
  add(6, 11, 'canva.exe', 'Canva', null, null);
  add(11, 14, 'code.exe', 'Visual Studio Code', null, null);
  add(14, 15, 'blip.exe', 'Blip', null, null);

  await s.debug.advance(900);
  const asks = p.getByTestId('prompt-asks');
  await expect(asks).toContainText('How do these count?');
  const rows = asks.getByTestId('ask-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('youtube.com');
  await expect(rows.nth(1)).toContainText('Canva');
  await expect(rows.nth(2)).toContainText('Visual Studio Code');
  // The label it has now is marked; an unlabelled app has none.
  await expect(rows.nth(0).locator('[data-category=distracting]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.nth(1).locator('[aria-pressed=true]')).toHaveCount(0);
  await p.getByLabel('Answer').fill('Research');
  await shot(p, 'prompt-asks');

  // YouTube was research: one click files it as Productive, and the row goes.
  await rows.nth(0).locator('[data-category=productive]').click();
  await expect(rows).toHaveCount(2);
  const rule = (pattern: string) => s!.db().prepare('SELECT category, is_default FROM rules WHERE pattern = ? AND is_default = 0').get(pattern);
  await expect.poll(() => rule('youtube.com')).toEqual({ category: 'productive', is_default: 0 });
  // Answering the block doesn't wait for the rest.
  await p.getByTestId('account-save').click();
  await expect(p.getByTestId('prompt-account')).toHaveCount(0);

  // Rules → To sort: everything still without the user's own label, pre-labelled ones marked default.
  await d.evaluate(() => window.spyder.openDashboard('rules'));
  await d.getByTestId('rules-tabs').locator('[data-value=inbox]').click();
  const inbox = d.getByTestId('inbox-row');
  await expect(inbox).toHaveCount(2);
  await expect(inbox.nth(0)).toContainText('Canva');
  await expect(inbox.nth(1)).toContainText('Visual Studio Code');
  await expect(inbox.nth(1)).toContainText('default');
  await shot(d, 'rules-to-sort');
  // Confirming the default is a click too: it becomes the user's rule and leaves the list.
  await inbox.nth(1).locator('[data-category=productive]').click();
  await expect(inbox).toHaveCount(1);
  expect(rule('code.exe')).toEqual({ category: 'productive', is_default: 0 });
  await inbox.nth(0).locator('[data-category=neutral]').click();
  await expect(d.getByText('Everything you use has a category you picked')).toBeVisible();
  expect(rule('canva.exe')).toEqual({ category: 'neutral', is_default: 0 });
});
