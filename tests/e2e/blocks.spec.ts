/// <reference lib="dom" />
// Editing blocks from Today's block log (P64, P66): joined answers, re-answer, answer many, tags, delete → untracked
// → Undo, merge adjacent → Undo, the merge rules, the running block, the timeline picks a row.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { appRuns, appSlot, timeSplit } from '../../src/core/aggregate';
import { dur, statTexts } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, openRuns, seed, shot, type Launched } from './helpers';

const DATE = '2026-11-24';

async function expected(dataDir: string, nowMs: number) {
  const db = new Db(join(dataDir, 'spyder.db'));
  try {
    return dayVM(db, DATE, nowMs, loadSettings(db));
  } finally {
    db.close();
  }
}

const rows = (d: Page, answer: string) => d.getByTestId('block-row').filter({ has: d.getByTestId('block-answer').getByText(answer, { exact: true }) });
type Host = { engine: { loop: { block: { id: string } } | null } };

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

test('joined answers, re-answer, answer many, delete → undo, merge → undo on a seeded day', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  const nowMs = (await s.debug.state()).now as number;
  const vm0 = await expected(dir, nowMs);
  // Every block and the untracked gap, in time order.
  await expect(d.getByTestId('block-row')).toHaveCount(vm0.summary.sessions.length);
  await expect(d.getByTestId('log-untracked')).toHaveCount(1);
  await expect(rows(d, 'Not accounted for')).toHaveCount(2);
  await expect(d.getByTestId('block-log')).toContainText('2 not accounted for');
  // Consecutive blocks with the same answer are shown joined (P64).
  await expect(rows(d, 'Replying to emails').first().getByTestId('block-group')).toHaveText('2 blocks · 30m');
  await expect(rows(d, 'Replying to emails').nth(1)).toHaveAttribute('data-joined', 'true');
  await expect(rows(d, 'Code review').first().getByTestId('block-group')).toHaveText('3 blocks · 45m');
  await d.mouse.move(0, 0);
  await shot(d, 'today-log');

  // Re-answer one block inline.
  await rows(d, 'Inbox zero').getByTestId('block-answer').click();
  const edit = d.getByTestId('block-edit-row');
  await edit.getByLabel('Answer').fill('Triage inbox');
  await shot(d, 'today-reanswer');
  await edit.getByLabel('Answer').press('Enter');
  await expect(rows(d, 'Triage inbox')).toHaveCount(1);
  expect(s.db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE name = 'Triage inbox'").get()).toEqual({ n: 1 });

  // Select the two unanswered blocks and give them one answer: they join the Wrap-up run.
  for (const r of await rows(d, 'Not accounted for').all()) await r.getByTestId('block-check').click();
  await expect(d.getByTestId('selection-bar')).toContainText('2 selected');
  await d.getByTestId('answer-open').click();
  await d.getByTestId('answer-panel').getByLabel('Answer').fill('Wrap-up');
  await shot(d, 'today-answer-many');
  await d.getByTestId('panel-save').click();
  await expect(rows(d, 'Not accounted for')).toHaveCount(0);
  const wrapUps = (await expected(dir, nowMs)).summary.sessions.filter((x) => x.name === 'Wrap-up').length;
  await expect(rows(d, 'Wrap-up').first().getByTestId('block-group')).toHaveText(`${wrapUps} blocks · ${dur(wrapUps * 900)}`);

  // Delete: its time becomes untracked; the stat row follows; Undo puts it back.
  const triage = rows(d, 'Triage inbox');
  await triage.hover();
  await triage.getByTestId('block-delete').click();
  await expect(d.getByTestId('toast')).toContainText('Deleted “Triage inbox”');
  await expect(rows(d, 'Triage inbox')).toHaveCount(0);
  await expect(d.getByTestId('log-untracked')).toHaveCount(2);
  const vm1 = await expected(dir, nowMs);
  await expect(d.getByTestId('stat-work')).toHaveText(statTexts(vm1.summary, vm1.streak).work);
  await d.mouse.move(0, 0);
  await shot(d, 'today-deleted');
  await d.getByTestId('toast-undo').click();
  await expect(rows(d, 'Triage inbox')).toHaveCount(1);
  await expect(d.getByTestId('log-untracked')).toHaveCount(1);

  // Merge the three Code review blocks into one 45-min block; Undo splits them again.
  for (const r of await rows(d, 'Code review').all()) await r.getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  const panel = d.getByTestId('merge-panel');
  await expect(panel).toContainText('They become one 45m block, 12:45–13:30, with one answer.');
  await expect(panel.getByLabel('Answer')).toHaveValue('Code review');
  await shot(d, 'today-merge');
  await d.getByTestId('panel-save').click();
  await expect(d.getByTestId('toast')).toContainText('Merged 3 blocks into “Code review”');
  await expect(rows(d, 'Code review')).toHaveCount(1);
  await expect(rows(d, 'Code review').getByTestId('block-dur')).toHaveText('45m');
  const merged = s.db().prepare("SELECT id, started_ms, ended_ms FROM sessions WHERE name = 'Code review' AND deleted_ms IS NULL").all() as { id: string }[];
  expect(merged).toHaveLength(1);
  expect(s.db().prepare('SELECT COUNT(*) AS n FROM segments WHERE session_id = ?').get(merged[0].id)).toEqual({ n: 3 });
  expect((await expected(dir, nowMs)).summary.workSec).toBe(vm0.summary.workSec); // merging moves time, never invents it
  await d.getByTestId('toast-undo').click();
  await expect(rows(d, 'Code review')).toHaveCount(3);

  // Only adjacent blocks merge, and never a break with work.
  await rows(d, 'Replying to emails').first().getByTestId('block-check').click();
  await rows(d, 'Code review').first().getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('Only blocks next to each other can be merged');
  await d.getByRole('button', { name: 'Clear' }).click();
  await rows(d, 'Code review').nth(2).getByTestId('block-check').click();
  await rows(d, 'Break').nth(3).getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('A break can’t be merged with work blocks');
  await d.getByRole('button', { name: 'Clear' }).click();

  // Clicking a block in the timeline highlights its row.
  const id = (s.db().prepare("SELECT id FROM sessions WHERE name = 'Standup'").get() as { id: string }).id;
  const block = d.locator(`[data-block=session][data-session="${id}"]`).first();
  await block.click();
  await expect(d.locator(`[data-testid=block-row][data-session="${id}"]`)).toHaveAttribute('data-picked', 'true');
  await d.getByTestId('timeline-card').scrollIntoViewIfNeeded();
  await block.hover();
  await shot(d, 'today-timeline');

  // The app track (P77): one run per stretch on an app or site, every switch kept; the biggest app leads the legend.
  const runs = appRuns((await expected(dir, nowMs)).summary.timeline.activity);
  expect(runs.length).toBeGreaterThan(1);
  await expect(d.locator('[data-block=app]')).toHaveCount(runs.length);
  const ms = new Map<string, number>();
  for (const r of runs) ms.set(r.key, (ms.get(r.key) ?? 0) + r.endMs - r.startMs);
  const biggest = [...ms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const legend = d.getByTestId('app-legend');
  await expect(legend.locator('span.truncate').first()).toHaveText(biggest);
  // Every app has a colour fixed by its name (P79); picking one from the legend recolours it at once and is kept.
  const run = d.locator(`[data-block=app][data-key="${biggest}"]`).first();
  await expect(run).toHaveAttribute('fill', `var(--color-app-${appSlot(biggest) + 1})`);
  await legend.getByTestId('app-color').first().fill('#123456');
  await expect(run).toHaveAttribute('fill', '#123456');
  await expect.poll(() => (s!.db().prepare("SELECT value FROM settings WHERE key = 'appColors'").get() as { value: string } | undefined)?.value).toBe(
    JSON.stringify({ [biggest]: '#123456' }),
  );
  // P81: the Apps & sites list shows the same colour, and picking there recolours the track too.
  const listSwatch = d.getByTestId('app-row').filter({ hasText: biggest }).getByTestId('app-color');
  await expect(listSwatch).toHaveValue('#123456');
  await listSwatch.fill('#654321');
  await expect(run).toHaveAttribute('fill', '#654321');

  // P85: the switch under the timeline swaps the app track and its legend for the old category strip, and is kept.
  const sw = d.getByTestId('app-track-toggle');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const tall = (await d.getByTestId('timeline').boundingBox())!.height;
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(d.locator('[data-block=app]')).toHaveCount(0);
  await expect(legend).toHaveCount(0);
  await expect(d.locator('[data-block=category]')).toHaveCount((await expected(dir, nowMs)).summary.timeline.activity.length);
  await expect(d.locator('[data-block=category]').first()).toHaveAttribute('height', '4');
  await expect(d.locator('[data-block=session]').first()).toBeVisible();
  expect((await d.getByTestId('timeline').boundingBox())!.height).toBeLessThan(tall);
  await expect.poll(() => (s!.db().prepare("SELECT value FROM settings WHERE key = 'showAppTrack'").get() as { value: string } | undefined)?.value).toBe('false');
  await d.waitForTimeout(300); // let the switch finish sliding
  await d.getByTestId('timeline-card').scrollIntoViewIfNeeded();
  await shot(d, 'today-timeline-no-apps');
  await d.reload();
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  await expect(d.getByTestId('app-track-toggle')).toHaveAttribute('aria-checked', 'false');
  await expect(d.locator('[data-block=app]')).toHaveCount(0);
  await d.getByTestId('app-track-toggle').click();
  await expect(d.locator('[data-block=app]')).toHaveCount(runs.length);
});

test('neighbours merge across a gap too short to show; Merge repeats merges every run with one Undo (P73)', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  // Start the second Code review block 30 s late: nothing shows between the two, so they're still neighbours.
  const db = new Db(join(dir, 'spyder.db'));
  const second = (db.all("SELECT id FROM sessions WHERE name = 'Code review' ORDER BY started_ms") as { id: string }[])[1].id;
  db.run('UPDATE sessions SET started_ms = started_ms + 30000 WHERE id = ?', second);
  db.run('UPDATE segments SET start_ms = start_ms + 30000 WHERE session_id = ?', second);
  db.close();
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  await expect(rows(d, 'Code review').first().getByTestId('block-group')).toContainText('3 blocks');
  for (const r of (await rows(d, 'Code review').all()).slice(0, 2)) await r.getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('They become one');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await d.getByRole('button', { name: 'Clear' }).click();

  // Merge repeats: every joined run becomes one block; Undo splits them all again.
  const before = await d.getByTestId('block-row').count();
  const joined = await d.locator('[data-testid=block-row][data-joined=true]').count();
  expect(joined).toBeGreaterThan(1);
  const runs = await d.getByTestId('block-group').count();
  await expect(d.getByRole('button', { name: 'Export…' })).toHaveCount(0); // P72: export lives in Settings
  await d.mouse.move(0, 0);
  await shot(d, 'today-merge-repeats');
  await d.getByTestId('merge-repeats').click();
  await expect(d.getByTestId('toast')).toContainText(`Merged ${joined + runs} blocks into ${runs}`);
  await expect(d.getByTestId('block-row')).toHaveCount(before - joined);
  await expect(d.getByTestId('merge-repeats')).toHaveCount(0);
  await expect(rows(d, 'Code review')).toHaveCount(1);
  const vm = await expected(dir, (await s.debug.state()).now as number);
  expect(vm.summary.sessions.filter((x) => x.name === 'Code review')).toHaveLength(1);
  await d.getByTestId('toast-undo').click();
  await expect(d.getByTestId('block-row')).toHaveCount(before);
  await expect(rows(d, 'Code review')).toHaveCount(3);
});

test('a merged block can be unmerged any time, even after a restart, back to the blocks as they were (P86)', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  let d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  const nowMs = (await s.debug.state()).now as number;
  const vm0 = await expected(dir, nowMs);
  await expect(d.getByTestId('block-unmerge')).toHaveCount(0); // nothing is merged yet

  // Merge the three Code review blocks under a new answer, then rate the merged block.
  for (const r of await rows(d, 'Code review').all()) await r.getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await d.getByTestId('merge-panel').getByLabel('Answer').fill('Reviews');
  await d.getByTestId('panel-save').click();
  await expect(rows(d, 'Reviews')).toHaveCount(1);
  await rows(d, 'Reviews').getByTestId('block-efficiency').selectOption('100');
  await expect(rows(d, 'Reviews').getByTestId('block-efficiency')).toHaveValue('100');

  // A restart loses the toast's Undo, not the merge record.
  await s.close();
  s = await launch({ dataDir: dir, now: `${DATE}T18:05:00` });
  d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  await expect(d.getByTestId('block-unmerge')).toHaveCount(1);
  await expect(rows(d, 'Reviews').getByTestId('block-unmerge')).toHaveCount(1);
  await rows(d, 'Reviews').hover();
  await shot(d, 'today-unmerge');

  // Unmerge: the three blocks come back as they were before the merge (answer, no rating, times).
  await rows(d, 'Reviews').getByTestId('block-unmerge').click();
  await expect(d.getByTestId('toast')).toContainText('Unmerged “Reviews” into 3 blocks');
  await expect(rows(d, 'Reviews')).toHaveCount(0);
  await openRuns(d);
  await expect(rows(d, 'Code review')).toHaveCount(3);
  for (const r of await rows(d, 'Code review').all()) await expect(r.getByTestId('block-efficiency')).toHaveValue('none');
  await expect(d.getByTestId('block-unmerge')).toHaveCount(0);
  // The ended blocks are back exactly (the blocks each launch started aside).
  const line = (x: (typeof vm0.summary.sessions)[number]) => [x.id, x.name, x.tag, x.efficiency, x.startMs, x.endMs, x.daySec];
  const ended = vm0.summary.sessions.filter((x) => !x.running);
  const ids = new Set(ended.map((x) => x.id));
  const vm1 = await expected(dir, nowMs);
  expect(vm1.summary.sessions.filter((x) => ids.has(x.id)).map(line)).toEqual(ended.map(line));
  expect(s.db().prepare('SELECT COUNT(*) AS n FROM merges').get()).toEqual({ n: 0 });

  // Undo merges them again, rating and all, and the block can still be unmerged.
  await d.getByTestId('toast-undo').click();
  await expect(rows(d, 'Reviews')).toHaveCount(1);
  await expect(rows(d, 'Reviews').getByTestId('block-efficiency')).toHaveValue('100');
  await expect(rows(d, 'Reviews').getByTestId('block-unmerge')).toHaveCount(1);
});

test('the running block can’t be edited until it ends; an ended one can', async () => {
  s = await launch({ scale: 1 });
  const d = s.dashboard;
  await s.prompt.getByTestId('reminder-start').click();
  await s.debug.advance(1200);
  await s.prompt.getByLabel('Answer').fill('Morning admin');
  await s.prompt.getByTestId('account-save').click();
  await d.evaluate(() => window.spyder.openDashboard('today'));
  const running = d.getByTestId('block-row').filter({ hasText: 'Running' });
  await expect(running).toHaveCount(1);
  await expect(running.getByTestId('block-check')).toBeDisabled();
  await expect(running.getByTestId('block-edit')).toHaveCount(0);
  const runId = ((await s.debug.state()).host as Host).engine.loop!.block.id;
  const err = { error: 'invalid', message: 'The running block can’t be edited until it ends' };
  expect(await d.evaluate((id) => window.spyder.deleteBlocks([id]), runId)).toEqual(err);
  expect(await d.evaluate((id) => window.spyder.answerBlocks([{ id, answer: 'x' }]), runId)).toEqual({
    error: 'invalid',
    message: 'The running block can’t be answered until it ends',
  });

  // The ended block: delete → its 15 min join the hour before Start as one untracked span.
  await rows(d, 'Morning admin').hover();
  await rows(d, 'Morning admin').getByTestId('block-delete').click();
  await expect(d.getByTestId('log-untracked')).toContainText('10:00–11:15');
  await d.getByTestId('toast-undo').click();
  await expect(d.getByTestId('log-untracked')).toContainText('10:00–11:00');
});

test('tags: Work/Break apart from the answer, per row and in bulk; merge needs one tag; work colour; the review pie (P66–P68)', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  const d = s.dashboard;
  const kindName = (name: string) => s!.db().prepare('SELECT kind, name FROM sessions WHERE name = ? AND deleted_ms IS NULL').all(name);
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  await expect(rows(d, 'Code review').first().getByTestId('block-tag')).toHaveValue('work');
  await expect(rows(d, 'Break').first().getByTestId('block-tag')).toHaveValue('break');

  // A block keeps its answer when it becomes a break; it then merges with the break next to it.
  const lastReview = rows(d, 'Code review').nth(2);
  await lastReview.getByTestId('block-tag').selectOption('break');
  await expect(d.getByTestId('toast')).toContainText('“Code review” is now a break');
  await expect(rows(d, 'Code review').nth(2).getByTestId('block-tag')).toHaveValue('break');
  expect(kindName('Code review').filter((r) => (r as { kind: string }).kind === 'break')).toHaveLength(1);
  await rows(d, 'Code review').nth(1).getByTestId('block-check').click();
  await rows(d, 'Code review').nth(2).getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('A break can’t be merged with work blocks. Change their tags first.');
  await d.getByRole('button', { name: 'Clear' }).click();
  await rows(d, 'Code review').nth(2).getByTestId('block-check').click();
  await rows(d, 'Break').nth(3).getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('They become one 30m break');
  await d.getByTestId('merge-panel').getByLabel('Answer').fill('took a nap');
  await d.getByTestId('panel-save').click();
  await expect(d.getByTestId('toast')).toContainText('Merged 2 blocks into “took a nap”');
  expect(kindName('took a nap')).toEqual([{ kind: 'break', name: 'took a nap' }]);
  await expect(rows(d, 'took a nap').getByTestId('block-dur')).toHaveText('30m');

  // Re-answering a break with Save keeps it a break.
  await rows(d, 'took a nap').getByTestId('block-answer').click();
  await d.getByTestId('block-edit-row').getByLabel('Answer').fill('nap on the couch');
  await d.getByTestId('edit-save').click();
  expect(kindName('nap on the couch')).toEqual([{ kind: 'break', name: 'nap on the couch' }]);
  await d.mouse.move(0, 0);
  await shot(d, 'today-tags');

  // Bulk: tick two blocks and tag them; Undo puts them back.
  for (const r of await rows(d, 'Replying to emails').all()) await r.getByTestId('block-check').click();
  await d.getByTestId('tag-selected').selectOption('break');
  await expect(d.getByTestId('toast')).toContainText('Tagged 2 blocks Break');
  expect(kindName('Replying to emails')).toEqual([
    { kind: 'break', name: 'Replying to emails' },
    { kind: 'break', name: 'Replying to emails' },
  ]);
  await d.getByTestId('toast-undo').click();
  await expect.poll(() => kindName('Replying to emails').map((r) => (r as { kind: string }).kind)).toEqual(['open', 'open']);

  // A plain Break that becomes work isn't accounted for any more.
  await expect(d.getByTestId('block-log')).toContainText('2 not accounted for');
  await rows(d, 'Break').first().getByTestId('block-tag').selectOption('work');
  await expect(d.getByTestId('block-log')).toContainText('3 not accounted for');
  await d.getByTestId('toast-undo').click();
  await expect(d.getByTestId('block-log')).toContainText('2 not accounted for');

  // P67: the work colour comes from Settings (green by default) and applies at once.
  const workColor = () => d.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-work').trim().toLowerCase());
  expect(await workColor()).toBe('#3fb27f');
  await d.evaluate(() => window.spyder.openDashboard('settings'));
  await d.getByTestId('set-workColor').fill('#e05a9b');
  await expect.poll(workColor).toBe('#e05a9b');
  await shot(d, 'settings-work-color');
  await d.getByTestId('reset-workColor').click();
  await expect.poll(workColor).toBe('#3fb27f');

  // P68: the review shows where the day went.
  await d.evaluate(() => window.spyder.openDashboard('review'));
  const nowMs = (await s.debug.state()).now as number;
  const parts = timeSplit((await expected(dir, nowMs)).summary);
  const pie = d.getByTestId('time-split');
  for (const p of parts) await expect(pie.getByTestId(`split-${p.key}`)).toContainText(dur(p.sec));
  expect(parts.map((p) => p.key)).toEqual(['work', 'break', 'unanswered', 'untracked']);
  await expect(pie.locator('[data-slice]')).toHaveCount(4);
  await pie.locator('[data-slice=break]').hover();
  await shot(d, 'review-pie');
});

test('Gym and Food: break tags with their own colours, label and slices (P74)', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  await openRuns(d);
  const firstBreak = (await rows(d, 'Break').first().getAttribute('data-session'))!;

  // A break tagged Gym reads "Gym", stays a break, and takes the gym colour.
  await rows(d, 'Break').first().getByTestId('block-tag').selectOption('gym');
  await expect(d.getByTestId('toast')).toContainText('“Break” is now gym');
  await expect(rows(d, 'Gym').getByTestId('block-tag')).toHaveValue('gym');
  expect(s.db().prepare('SELECT kind, tag, name FROM sessions WHERE id = ?').get(firstBreak)).toEqual({ kind: 'break', tag: 'gym', name: 'Break' });
  await expect(d.locator(`[data-block=session][data-session="${firstBreak}"]`).first()).toHaveAttribute('fill', 'var(--color-gym)');
  await rows(d, 'Break').first().getByTestId('block-tag').selectOption('food');
  await expect(rows(d, 'Food').getByTestId('block-tag')).toHaveValue('food');

  // Gym and Food are different tags: they don't join, and can't be merged.
  await expect(rows(d, 'Gym').getByTestId('block-group')).toHaveCount(0);
  await rows(d, 'Gym').getByTestId('block-check').click();
  await rows(d, 'Food').getByTestId('block-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-panel')).toContainText('Blocks with different tags can’t be merged. Change their tags first.');
  await d.getByRole('button', { name: 'Clear' }).click();

  // Answering a gym block with Save keeps it Gym; the time still counts as break.
  await rows(d, 'Gym').getByTestId('block-answer').click();
  await d.getByTestId('block-edit-row').getByLabel('Answer').fill('leg day');
  await d.getByTestId('edit-save').click();
  await expect(rows(d, 'leg day').getByTestId('block-tag')).toHaveValue('gym');
  const nowMs = (await s.debug.state()).now as number;
  const vm = await expected(dir, nowMs);
  await expect(d.getByTestId('stat-work')).toHaveText(statTexts(vm.summary, vm.streak).work);
  await d.mouse.move(0, 0);
  await shot(d, 'today-gym-food');

  // Colours come from Settings: orange and pink by default.
  const color = (v: string) => () => d.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), v);
  await d.evaluate(() => window.spyder.openDashboard('settings'));
  expect(await color('--color-gym')()).toBe('#e8853d');
  expect(await color('--color-food')()).toBe('#d9669b');
  await d.getByTestId('set-gymColor').fill('#ff0000');
  await expect.poll(color('--color-gym')).toBe('#ff0000');
  await d.getByTestId('reset-gymColor').click();
  await expect.poll(color('--color-gym')).toBe('#e8853d');

  // Where the day went has Gym and Food slices.
  await d.evaluate(() => window.spyder.openDashboard('review'));
  const parts = timeSplit(vm.summary);
  expect(parts.map((p) => p.key)).toEqual(['work', 'break', 'gym', 'food', 'unanswered', 'untracked']);
  const pie = d.getByTestId('time-split');
  for (const p of parts) await expect(pie.getByTestId(`split-${p.key}`)).toContainText(dur(p.sec));
  await pie.locator('[data-slice=gym]').hover();
  await shot(d, 'review-pie-gym-food');
});

test('the prompt’s Break keeps typed text as the break’s answer (P66)', async () => {
  s = await launch({ scale: 1 });
  await s.prompt.getByTestId('reminder-start').click();
  await s.debug.advance(900);
  await s.prompt.getByLabel('Answer').fill('took a nap');
  await s.prompt.getByTestId('account-break').click();
  await expect.poll(() => s!.db().prepare("SELECT kind, name FROM sessions WHERE status = 'done'").all()).toEqual([{ kind: 'break', name: 'took a nap' }]);
});
