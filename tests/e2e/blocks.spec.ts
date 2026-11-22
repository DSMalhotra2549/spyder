/// <reference lib="dom" />
// Editing blocks from Today's block log (P64): joined answers, re-answer, answer many, delete → untracked
// → Undo, merge adjacent → Undo, the merge rules, the running block, the timeline picks a row.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { dur, statTexts } from '../../src/renderer/dashboard/stats';
import { freshDataDir, launch, seed, shot, type Launched } from './helpers';

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
