/// <reference lib="dom" />
// The block loop end to end (ADR-0011, P58–P63): start reminder, Start/Stop, accounting prompt,
// missed blocks, block length, end of work hours, Spyder not running, and the bar.
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { freshDataDir, launch, shot, type Launched } from './helpers';

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

type HostState = {
  toastCount: number;
  engine: {
    mode: string;
    reminder: boolean;
    loop: { lengthSec: number; untilStop: boolean; block: { id: string; startedMs: number; lengthSec: number } } | null;
  };
  widgetVM: { isDistracted: boolean; timerSec: number; pendingCount: number };
};
const host = async (l: Launched) => (await l.debug.state()).host as HostState;
const T = (h: number, m = 0, s = 0) => new Date(2026, 10, 24, h, m, s).getTime();

const promptVisible = (l: Launched) =>
  l.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('#/prompt'))!
      .isVisible(),
  );

const widgetBounds = (l: Launched) =>
  l.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('#/widget'))!
      .getBounds(),
  );

type Block = { name: string | null; kind: string; started_ms: number; ended_ms: number | null };
const blocks = (l: Launched) =>
  l.db().prepare('SELECT name, kind, started_ms, ended_ms FROM sessions WHERE deleted_ms IS NULL ORDER BY started_ms').all() as Block[];

const MIN = 60_000;
/** When the running block started. */
const startedAt = async (l: Launched) => {
  await expect.poll(async () => (await host(l)).engine.loop).not.toBeNull();
  return (await host(l)).engine.loop!.block.startedMs;
};

/** Presses Start in the dashboard sidebar (P59). */
async function startFromSidebar(l: Launched) {
  await l.widget.evaluate(() => window.spyder.openDashboard('today'));
  await l.dashboard.getByTestId('sidebar-start').click();
  await expect.poll(async () => (await host(l)).engine.loop).not.toBeNull();
}

test('1. start reminder → Start → each block ends with "what did you do?" → Save, Same as last, Break (P59, P60)', async () => {
  s = await launch({ scale: 1 });
  const p = s.prompt;
  const bar = s.widget.getByTestId('pill');
  // Work hours, nothing running: the bar says Not started and the reminder pops up.
  await expect(p.getByTestId('prompt-reminder')).toBeVisible();
  await expect(p.getByTestId('prompt-reminder')).toContainText('Press Start to begin 15m blocks.');
  expect(await promptVisible(s)).toBe(true);
  await expect(bar).toHaveAttribute('data-state', 'not-started');
  await expect(s.widget.getByTestId('bar-status')).toHaveText('Not started');
  await shot(p, 'prompt-reminder');
  await shot(s.widget, 'widget-bar-not-started');
  expect(blocks(s)).toEqual([]);

  await p.getByTestId('reminder-start').click();
  // The test clock runs in real time, so Start lands a moment after 11:00.
  const t0 = await startedAt(s);
  expect(t0 - T(11)).toBeLessThan(5000);
  await expect.poll(() => promptVisible(s!)).toBe(false);
  await expect(bar).toHaveAttribute('data-state', 'running');

  // Counts up within the block (P63).
  await s.debug.advance(185);
  await expect(s.widget.getByTestId('timer')).toHaveText(/^03:0[5-9]$/);
  await expect(bar).toContainText(/block\s*of 15m/i);

  await s.debug.advance(715);
  await expect(p.getByTestId('prompt-account')).toBeVisible();
  await expect(p.getByTestId('prompt-account')).toContainText('What did you do 11:00–11:15?');
  await expect.poll(() => promptVisible(s!)).toBe(true);
  // The next block is already running.
  await expect.poll(async () => (await host(s!)).engine.loop?.block.startedMs).toBe(t0 + 15 * MIN);
  await expect(s.widget.getByTestId('prompt-dot')).toBeVisible();
  await p.getByLabel('Answer').fill('Replying to emails');
  await shot(p, 'prompt-account');
  await p.getByTestId('account-save').click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  expect(blocks(s)[0]).toMatchObject({ name: 'Replying to emails', kind: 'open', started_ms: t0, ended_ms: t0 + 15 * MIN });

  await s.debug.advance(900);
  await expect(p.getByTestId('account-same')).toHaveText('Same: Replying to emails');
  await p.getByTestId('account-same').click();
  await expect.poll(() => blocks(s!)[1]?.name).toBe('Replying to emails');

  await s.debug.advance(900);
  await expect(p.getByTestId('prompt-account')).toContainText('11:30–11:45');
  await p.getByTestId('account-break').click();
  await expect.poll(() => blocks(s!)[2]).toMatchObject({ kind: 'break', name: 'Break' });
  expect(blocks(s)[3]).toMatchObject({ name: null, started_ms: t0 + 45 * MIN, ended_ms: null });
});

test('2. missed blocks share one prompt: one answer for all, or each separately; away is a hint (P60, P61)', async () => {
  s = await launch({ scale: 1 });
  await startFromSidebar(s);
  const t0 = await startedAt(s);
  const p = s.prompt;
  // Away 11:05–11:25 (sleep): the loop keeps running.
  await s.debug.advance(300);
  await s.debug.simulateSuspend();
  await s.debug.advance(1200);
  await s.debug.simulateResume();
  await s.debug.advance(2100); // 12:00
  await expect(p.getByTestId('prompt-account')).toContainText('What did you do in these 4 blocks?');
  await expect(p.getByTestId('prompt-account')).toContainText('11:00–11:15');
  await expect(p.getByTestId('prompt-account')).toContainText('Away 10m');
  expect((await host(s)).engine.loop?.block.startedMs).toBe(t0 + 60 * MIN);
  await shot(p, 'prompt-account-many');

  await p.getByTestId('account-mode').locator('[data-value=each]').click();
  const rows = p.getByTestId('account-row');
  await expect(rows).toHaveCount(4);
  await rows.nth(0).getByLabel('Answer').fill('Standup');
  await rows.nth(1).getByTestId('account-row-break').click();
  await rows.nth(2).getByLabel('Answer').fill('Code review');
  await shot(p, 'prompt-account-each');
  await p.getByTestId('account-save').click();
  // The empty row stays for later.
  await expect(p.getByTestId('prompt-account')).toContainText('What did you do 11:45–12:00?');
  expect(blocks(s).slice(0, 3).map((b) => [b.kind, b.name])).toEqual([
    ['open', 'Standup'],
    ['break', 'Break'],
    ['open', 'Code review'],
  ]);
  await p.getByLabel('Answer').fill('Code review');
  await p.getByLabel('Answer').press('Enter');
  await expect.poll(() => promptVisible(s!)).toBe(false);
  expect(blocks(s)[3].name).toBe('Code review');
});

test('3. block length applies from the next block; Stop asks about the cut block; the reminder repeats (P59)', async () => {
  s = await launch({ scale: 1 });
  await s.widget.evaluate(() => window.spyder.openDashboard('today'));
  const d = s.dashboard;
  const len = d.getByTestId('block-length');
  await len.fill('10');
  await len.press('Enter');
  await expect.poll(() => s!.db().prepare("SELECT value FROM settings WHERE key = 'blockLengthSec'").get()).toEqual({ value: '600' });
  await s.prompt.getByTestId('reminder-later').click();
  await d.getByTestId('sidebar-start').click();
  await expect.poll(async () => (await host(s!)).engine.loop?.block.lengthSec).toBe(600);
  const t0 = await startedAt(s);
  await expect(d.getByTestId('sidebar-timer')).toBeVisible();
  await shot(d, 'sidebar-controls');

  await s.debug.advance(300);
  await len.fill('20');
  await len.press('Enter');
  await expect.poll(async () => (await host(s!)).engine.loop?.lengthSec).toBe(1200);
  expect((await host(s)).engine.loop?.block.lengthSec).toBe(600);
  await s.debug.advance(300);
  await expect.poll(async () => (await host(s!)).engine.loop?.block).toMatchObject({ startedMs: t0 + 10 * MIN, lengthSec: 1200 });

  await s.debug.advance(120);
  await d.getByTestId('sidebar-stop').click();
  await expect.poll(async () => (await host(s!)).engine.loop).toBeNull();
  await expect(s.prompt.getByTestId('prompt-account')).toContainText('2 blocks');
  const [b1, b2] = blocks(s);
  expect([b1.started_ms, b1.ended_ms, b2.started_ms]).toEqual([t0, t0 + 10 * MIN, t0 + 10 * MIN]);
  expect(b2.ended_ms! - b2.started_ms).toBeGreaterThanOrEqual(2 * MIN);
  await s.prompt.getByLabel('Answer').fill('Setup');
  await s.prompt.getByTestId('account-save').click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  await expect(d.getByTestId('sidebar-start')).toBeVisible();

  // The reminder comes back a block length (now 20 min) after Stop.
  await s.debug.advance(1190);
  expect((await host(s)).engine.reminder).toBe(false);
  await s.debug.advance(15);
  await expect(s.prompt.getByTestId('prompt-reminder')).toBeVisible();
  await expect(s.prompt.getByTestId('prompt-reminder')).toContainText('20m blocks');
});

test('4. the end of work hours cuts the block; Keep working continues the loop (P62)', async () => {
  s = await launch({ scale: 1, now: '2026-11-24T16:50:00' });
  await startFromSidebar(s);
  await s.debug.setNow(T(17, 0, 5));
  await s.debug.tick();
  const bar = s.widget.getByTestId('pill');
  await expect(bar).toContainText('Off hours');
  await expect(bar).toContainText(/workday\s*done/i);
  await expect(s.widget.getByTestId('bar-day')).toContainText('100%');
  expect(blocks(s)[0].ended_ms).toBe(T(17));
  await expect(s.prompt.getByTestId('prompt-account')).toContainText('16:50–17:00');
  await shot(s.widget, 'widget-bar-offhours');

  await s.prompt.getByTestId('account-keep-working').click();
  await expect.poll(async () => (await host(s!)).engine.loop?.block.startedMs).toBe(T(17));
  expect((await host(s)).engine.mode).toBe('working');
  await expect(s.dashboard.getByTestId('sidebar-stop')).toBeVisible();
});

test('5. a loop started in off hours runs until Stop (P59)', async () => {
  s = await launch({ scale: 1, now: '2026-11-24T18:00:00' });
  await expect(s.widget.getByTestId('bar-status')).toHaveText('Off hours');
  expect(await promptVisible(s)).toBe(false);
  await startFromSidebar(s);
  const t0 = await startedAt(s);
  expect((await host(s)).engine.loop?.untilStop).toBe(true);
  await s.debug.advance(3 * 3600);
  await expect.poll(async () => (await host(s!)).engine.loop?.block.startedMs).toBe(t0 + 12 * 15 * MIN);
});

test('6. killed app → relaunch later → the loop stopped at the last heartbeat (P61)', async () => {
  const dataDir = freshDataDir();
  s = await launch({ dataDir });
  await startFromSidebar(s);
  await s.debug.advance(600);
  await s.debug.flush();
  s.db().close();
  // Hard-kill the whole process tree (no graceful quit, no final heartbeat).
  execSync(`taskkill /F /T /PID ${s.app.process().pid}`, { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  s = await launch({ dataDir, now: '2026-11-24T11:40:00' });
  await expect(s.prompt.getByTestId('prompt-account')).toContainText('What did you do 11:00–11:10?');
  expect((await host(s)).engine.loop).toBeNull();
  await s.prompt.getByLabel('Answer').fill('Setup');
  await s.prompt.getByTestId('account-save').click();
  // Then the start reminder: nothing restarts by itself.
  await expect(s.prompt.getByTestId('prompt-reminder')).toBeVisible();
  expect(blocks(s)).toHaveLength(1);
});

test('7. position persists; hide and hotkey', async () => {
  const dataDir = freshDataDir();
  s = await launch({ dataDir });
  await s.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('#/widget'))!
      .setPosition(240, 300),
  );
  await expect
    .poll(() => s!.db().prepare("SELECT value FROM settings WHERE key = 'widgetPos'").get())
    .toEqual({ value: JSON.stringify({ x: 240, y: 300 }) });
  await s.close();
  s = await launch({ dataDir });
  const b = await widgetBounds(s);
  expect({ x: b.x, y: b.y }).toEqual({ x: 240, y: 300 });

  // ready-to-show may land after page load; let it, so the hide below isn't undone.
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(true);
  await s.widget.evaluate(() => window.spyder.hideWidget());
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(false);
  await s.debug.triggerHotkey();
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(true);
});

test('8. bar: sharp corners, dashboard button, inert cells, minimize, drag handle; distracted (P49, P63)', async () => {
  s = await launch({ scale: 1 });
  const bar = s.widget.getByTestId('pill');
  const d = s.dashboard;
  await expect(bar).toHaveAttribute('data-style', 'bar');
  await expect.poll(async () => (await widgetBounds(s!)).width).toBe(528); // 512 bar + margins (P49)
  expect(await bar.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  // Tue 11:00, work 10–17 → 14% of day.
  await expect(s.widget.getByTestId('bar-day')).toContainText('14%');
  await expect(s.widget.getByTestId('bar-productive')).toContainText(/^\d+ min/);
  await s.prompt.getByTestId('reminder-start').click();
  await expect(bar).toHaveAttribute('data-state', 'running');
  await s.debug.advance(272);
  await expect(s.widget.getByTestId('timer')).toHaveText('04:32');
  await shot(s.widget, 'widget-bar-running');

  // Everything drags except the two buttons; the cells are not click targets (P49).
  const region = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region');
  expect(await bar.evaluate(region)).toBe('drag');
  for (const id of ['pill-body', 'bar-productive', 'bar-day']) expect(await s.widget.getByTestId(id).evaluate(region)).not.toBe('no-drag');
  const dash = s.widget.getByRole('button', { name: 'Open dashboard' });
  const mini = s.widget.getByRole('button', { name: 'Minimize' });
  expect(await dash.evaluate(region)).toBe('no-drag');
  expect(await mini.evaluate(region)).toBe('no-drag');
  await expect(s.widget.getByTestId('drag-handle')).toBeVisible();
  expect((await dash.boundingBox())!.x).toBeLessThan((await s.widget.getByTestId('pill-body').boundingBox())!.x);

  // Clicking a cell does nothing; the dashboard button opens Today.
  expect((await s.debug.state()).dashboardVisible).toBe(false);
  for (const id of ['pill-body', 'bar-productive', 'bar-day']) await s.widget.getByTestId(id).click();
  await s.widget.waitForTimeout(500);
  expect((await s.debug.state()).dashboardVisible).toBe(false);
  expect((await widgetBounds(s)).height).toBe(50);
  await d.evaluate(() => (location.hash = '/dashboard/week'));
  await dash.click();
  await expect.poll(async () => (await s!.debug.state()).dashboardVisible).toBe(true);
  await expect.poll(() => d.evaluate(() => location.hash)).toBe('#/dashboard/today');

  // Distracted while the loop runs: red, with the site; a flag and a toast after 5 min.
  const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', title: 'Lofi - YouTube', browser: 'chrome' as const };
  expect(await s.debug.injectActivity(yt)).toBe('distracting');
  await s.debug.advance(300);
  await s.debug.injectActivity(yt);
  const st = await host(s);
  expect(st.widgetVM.isDistracted).toBe(true);
  expect(st.toastCount).toBe(1);
  expect(s.db().prepare('SELECT target, continuous_sec, session_id FROM distraction_flags').get()).toMatchObject({
    target: 'youtube.com',
    continuous_sec: 300,
    session_id: st.engine.loop!.block.id,
  });
  await expect(s.widget.getByTestId('timer')).toHaveClass(/text-red/);
  await expect(bar).toContainText(/distracted\s*youtube\.com/i);
  await s.widget.waitForTimeout(2200);
  await shot(s.widget, 'widget-bar-distracted');
  await s.debug.injectActivity({ ...yt, exe: 'code.exe', appName: 'VS Code', domain: null, title: 'x', browser: null });

  // Minimize hides the bar; Show widget brings it back.
  await mini.click();
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(false);
  await d.getByRole('button', { name: 'Show widget' }).click();
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(true);
});
