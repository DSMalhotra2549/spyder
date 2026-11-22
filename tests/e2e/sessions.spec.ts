/// <reference lib="dom" />
// Editing sessions from Today's session log (P52–P55): rename, delete → untracked, merge, Undo;
// the running and paused cases; the timeline picks a row.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { dayVM } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { statTexts } from '../../src/renderer/dashboard/stats';
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

const row = (d: Page, name: string) => d.getByTestId('session-row').filter({ has: d.getByTestId('session-name').getByText(name, { exact: true }) });
type Host = { engine: { current: { id: string; name: string | null; kind: string } | null } };
const current = async (l: Launched) => ((await l.debug.state()).host as Host).engine.current;

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

test('rename, delete → untracked → undo, merge → undo on a seeded day', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  s = await launch({ dataDir: dir, now: `${DATE}T18:00:00` });
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('session-log').waitFor();
  const nowMs = (await s.debug.state()).now as number;
  const vm0 = await expected(dir, nowMs);
  // Every session, away period and untracked span is in the log, in time order (P55).
  await expect(d.getByTestId('session-row')).toHaveCount(vm0.summary.sessions.length);
  await expect(d.getByTestId('log-away')).toHaveCount(vm0.summary.away.length);
  await expect(d.getByTestId('log-untracked')).toHaveCount(0);
  await d.mouse.move(0, 0);
  await shot(d, 'today-log');

  // Rename: name + project inline; Enter saves.
  await row(d, 'Inbox zero').getByTestId('session-name').click();
  const edit = d.getByTestId('session-edit');
  await expect(edit).toBeVisible();
  await edit.getByLabel('Session name').fill('Triage inbox');
  await edit.getByLabel('Project').selectOption({ label: 'Client A' });
  await shot(d, 'today-rename');
  await edit.getByLabel('Session name').press('Enter');
  await expect(row(d, 'Triage inbox')).toContainText('Client A');
  expect(s.db().prepare("SELECT p.name FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.name = 'Triage inbox'").get()).toEqual({
    name: 'Client A',
  });

  // Delete: its time becomes untracked; the stat row follows; Undo puts it back exactly.
  const planning = row(d, 'Planning');
  await planning.hover();
  await planning.getByTestId('session-delete').click();
  await expect(d.getByTestId('toast')).toContainText('Deleted “Planning”');
  await expect(row(d, 'Planning')).toHaveCount(0);
  await expect(d.getByTestId('log-untracked')).toHaveCount(1);
  const vm1 = await expected(dir, nowMs);
  expect(vm1.summary.untrackedSec).toBeGreaterThanOrEqual(29 * 60);
  expect(vm1.summary.workSec).toBe(vm0.summary.workSec - 30 * 60);
  await expect(d.getByTestId('stat-work')).toHaveText(statTexts(vm1.summary, vm1.streak).work);
  expect(s.db().prepare("SELECT deleted_ms IS NOT NULL AS gone FROM sessions WHERE name = 'Planning'").get()).toEqual({ gone: 1 });
  await d.mouse.move(0, 0);
  await shot(d, 'today-deleted');
  await d.getByTestId('toast-undo').click();
  await expect(row(d, 'Planning')).toHaveCount(1);
  await expect(d.getByTestId('log-untracked')).toHaveCount(0);
  expect(s.db().prepare("SELECT deleted_ms FROM sessions WHERE name = 'Planning'").get()).toEqual({ deleted_ms: null });
  await expect(d.getByTestId('stat-work')).toHaveText(statTexts(vm0.summary, vm0.streak).work);

  // Merge: tick two, the longest is pre-picked; the kept one gains the other's segments.
  await row(d, 'Triage inbox').getByTestId('session-check').click();
  await row(d, 'Spyder dashboard').getByTestId('session-check').click();
  await expect(d.getByTestId('selection-bar')).toContainText('2 selected');
  await d.getByTestId('merge-open').click();
  const panel = d.getByTestId('merge-panel');
  const keepSd = s.db().prepare("SELECT id FROM sessions WHERE name = 'Spyder dashboard'").get() as { id: string };
  await expect(panel.locator(`[data-testid=merge-keep][value="${keepSd.id}"]`)).toBeChecked();
  await shot(d, 'today-merge');
  await d.getByTestId('merge-confirm').click();
  await expect(d.getByTestId('toast')).toContainText('Merged 2 sessions into “Spyder dashboard”');
  await expect(row(d, 'Triage inbox')).toHaveCount(0);
  expect(s.db().prepare('SELECT COUNT(*) AS n FROM segments WHERE session_id = ?').get(keepSd.id)).toEqual({ n: 2 });
  const vm2 = await expected(dir, nowMs);
  expect(vm2.summary.workSec).toBe(vm0.summary.workSec); // merging moves time, never invents it
  await d.getByTestId('toast-undo').click();
  await expect(row(d, 'Triage inbox')).toHaveCount(1);
  expect(s.db().prepare('SELECT COUNT(*) AS n FROM segments WHERE session_id = ?').get(keepSd.id)).toEqual({ n: 1 });

  // Breaks merge only with breaks.
  await row(d, 'Lunch').getByTestId('session-check').click();
  await row(d, 'Planning').getByTestId('session-check').click();
  await d.getByTestId('merge-open').click();
  await expect(d.getByTestId('merge-confirm')).toBeDisabled();
  await expect(d.getByTestId('merge-panel')).toContainText('Breaks merge only with breaks');

  // Clicking a session in the timeline highlights its row.
  await d.getByRole('button', { name: 'Clear' }).click();
  const block = d.locator(`[data-block=session][data-session="${keepSd.id}"]`).first();
  await block.click();
  await expect(d.locator(`[data-testid=session-row][data-session="${keepSd.id}"]`)).toHaveAttribute('data-picked', 'true');
  await d.getByTestId('timeline-card').scrollIntoViewIfNeeded();
  await block.hover();
  await shot(d, 'today-timeline');
});

test('delete the running session → fresh open session; undo resumes it; paused sessions are locked', async () => {
  s = await launch({ scale: 1 });
  const d = s.dashboard;
  await expect.poll(async () => (await current(s!))?.kind).toBe('open');
  await s.debug.advance(1200);
  const first = (await current(s))!;
  await s.widget.evaluate((id) => window.spyder.label(id, 'Morning admin', null), first.id);
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await expect(row(d, 'Morning admin')).toContainText('Running');

  await row(d, 'Morning admin').hover();
  await row(d, 'Morning admin').getByTestId('session-delete').click();
  await expect(d.getByTestId('toast')).toContainText('Deleted “Morning admin”');
  const fresh = (await current(s))!;
  expect(fresh.id).not.toBe(first.id);
  expect(fresh).toMatchObject({ kind: 'open', name: null });
  // Its 20 min join the hour before the app started as one untracked span.
  await expect(d.getByTestId('log-untracked')).toContainText('10:00–11:20');
  await expect(row(d, 'Unlabelled')).toContainText('Running');

  await d.getByTestId('toast-undo').click();
  await expect.poll(async () => (await current(s!))?.id).toBe(first.id);
  await expect(row(d, 'Morning admin')).toContainText('Running');
  await expect(d.getByTestId('log-untracked')).toContainText('10:00–11:00');
  expect(s.db().prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(fresh.id)).toEqual({ n: 0 });
  expect(s.db().prepare("SELECT status FROM sessions WHERE id = ?").get(first.id)).toEqual({ status: 'running' });

  // Paused: the session can't be deleted until it's resumed or done.
  await s.widget.evaluate(() => window.spyder.pause());
  await row(d, 'Morning admin').hover();
  await row(d, 'Morning admin').getByTestId('session-delete').click();
  await expect(d.getByTestId('toast')).toContainText('Resume or finish the paused session first');
  expect(s.db().prepare('SELECT deleted_ms FROM sessions WHERE id = ?').get(first.id)).toEqual({ deleted_ms: null });
});
