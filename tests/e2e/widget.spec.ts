/// <reference lib="dom" />
// Phase 3 verify (plan §13): widget, prompts, start popover, away, recovery, position, hotkey, screenshots.
import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { freshDataDir, launch, shot, type Launched } from './helpers';

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

type HostState = {
  ringCount: number;
  startOpen: boolean;
  toastCount: number;
  engine: { mode: string; current: { id: string; name: string | null; kind: string } | null; prompts: { type: string }[] };
  widgetVM: { isDistracted: boolean; isOvertime: boolean; timerSec: number };
};
const host = async (l: Launched) => (await l.debug.state()).host as HostState;

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

/** Opens the start popover from the dashboard sidebar, fills it and labels the boot session if asked (P21, P50). */
async function startFromSidebar(
  l: Launched,
  o: { tab: 'Planned' | 'Timed' | 'Open' | 'Break'; name?: string; minutes?: number; custom?: number },
  shotName?: string,
) {
  await l.widget.evaluate(() => window.spyder.openDashboard('today'));
  const d = l.dashboard;
  await (o.tab === 'Break'
    ? d.getByTestId('session-controls').getByRole('button', { name: 'Break' })
    : d.getByTestId('sidebar-start')
  ).click();
  const p = l.prompt;
  await expect(p.getByRole('tab', { name: 'Planned' })).toBeVisible();
  await p.getByRole('tab', { name: o.tab }).click();
  if (o.name) await p.getByLabel('Session name').first().fill(o.name);
  if (o.minutes) await p.getByRole('button', { name: String(o.minutes), exact: true }).click();
  if (o.custom) await p.getByLabel('Custom minutes').fill(String(o.custom));
  if (shotName) await shot(p, shotName);
  await p.getByRole('button', { name: 'Start ▶' }).click();
  const label = p.getByTestId('needs-label');
  await expect.poll(async () => !(await host(l)).startOpen || (await label.isVisible())).toBe(true);
  if (await label.isVisible()) {
    await expect(label).toContainText('What were you doing for the last');
    if (shotName) await shot(p, `${shotName}-needs-label`);
    await p.getByPlaceholder('Previous session').fill('Setup');
    await p.getByRole('button', { name: 'Start ▶' }).click();
  }
  await expect.poll(async () => (await host(l)).startOpen).toBe(false);
}

const title = (p: Page) => p.getByTestId('prompt-title');

test('1. planned countdown → timeUp → overtime → re-nag → +15', async () => {
  // Real time until the session starts, so no check-in (15 min, P51) beats the start form.
  s = await launch({ scale: 1 });
  await s.debug.advance(600);
  await startFromSidebar(s, { tab: 'Planned', name: 'Replying to emails', minutes: 30 }, 'start-popover');
  const st = await host(s);
  expect(st.engine.current).toMatchObject({ kind: 'planned', name: 'Replying to emails' });
  // Labelled boot session got its name.
  expect(s.db().prepare("SELECT kind FROM sessions WHERE name = 'Setup'").get()).toMatchObject({ kind: 'open' });

  await s.debug.setScale(600);
  await expect(title(s.prompt)).toHaveText("Time's up: Replying to emails", { timeout: 5000 });
  expect(await promptVisible(s)).toBe(true);
  // Slow the clock to real time so the rest of the scenario is deterministic.
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-timeUp');
  await s.widget.waitForTimeout(1000);
  const timer = s.widget.getByTestId('timer');
  await expect(timer).toHaveText(/^\+\d\d:\d\d$/);
  await expect(timer).toHaveClass(/text-red/);
  await shot(s.widget, 'widget-bar-overtime');

  const rings = (await host(s)).ringCount;
  expect(rings).toBeGreaterThanOrEqual(1);
  await s.debug.advance(300);
  await s.debug.tick();
  expect((await host(s)).ringCount).toBe(rings + 1);

  await s.prompt.getByRole('button', { name: '+15 min' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  await expect(timer).toHaveText(/^\d\d:\d\d$/);
  const t1 = (await host(s)).widgetVM.timerSec;
  await s.widget.waitForTimeout(1500);
  expect((await host(s)).widgetVM.timerSec).toBeLessThan(t1);
});

test('2. timed 10 min → label prompt → named in DB', async () => {
  s = await launch({ scale: 1 });
  await startFromSidebar(s, { tab: 'Timed', custom: 10 });
  await s.debug.setScale(600);
  await expect(title(s.prompt)).toHaveText(/^What did you do for the last 1\dm\?$/, { timeout: 5000 });
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-label');
  await s.prompt.getByLabel('Session name').fill('Inbox zero');
  await s.prompt.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  const row = s.db().prepare("SELECT kind, status, planned_sec FROM sessions WHERE name = 'Inbox zero'").get();
  expect(row).toMatchObject({ kind: 'timed', status: 'done', planned_sec: 600 });
});

test('3. open session → check-in after 15 min (P51) → Log & continue', async () => {
  s = await launch({ scale: 600 });
  await expect(title(s.prompt)).toHaveText(/^What have you been doing for the last 1\dm\?$/, { timeout: 6000 });
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-checkIn');
  await s.prompt.getByLabel('Session name').fill('Planning');
  await s.prompt.getByRole('button', { name: 'Log & continue' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  const st = await host(s);
  expect(st.engine.current).toMatchObject({ kind: 'open', name: 'Planning' });
  expect(s.db().prepare('SELECT name FROM sessions WHERE id = ?').get(st.engine.current!.id)).toMatchObject({
    name: 'Planning',
  });
  // Labelled check-in 15 min later.
  await s.debug.advance(900);
  await s.debug.tick();
  await expect(title(s.prompt)).toHaveText('Still on Planning?');
  await shot(s.prompt, 'prompt-checkIn-labelled');
  await s.prompt.getByRole('button', { name: 'Yes, still on it' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
});

test('4. suspend 72 min → away prompt → Break', async () => {
  s = await launch();
  await expect.poll(async () => (await host(s!)).engine.mode).toBe('working');
  await s.debug.simulateSuspend();
  expect((await host(s)).engine.mode).toBe('away');
  await expect(s.widget.getByTestId('pill')).toContainText('Away');
  await shot(s.widget, 'widget-bar-away');
  await s.debug.advance(4320);
  await s.debug.simulateResume();
  await expect(title(s.prompt)).toHaveText('You were away 1h 12m');
  await shot(s.prompt, 'prompt-away');
  await s.prompt.getByRole('button', { name: 'Break', exact: true }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  // No check-in right after: the 72 min away don't count toward it (P48).
  await s.prompt.waitForTimeout(1500);
  expect((await host(s)).engine.prompts).toEqual([]);
  const rows = s.db().prepare('SELECT classification, reason, end_ms - start_ms AS ms FROM away_periods').all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ classification: 'break', reason: 'suspend' });
  expect(Number(rows[0].ms)).toBeGreaterThanOrEqual(4320_000);
});

test('5. killed app → relaunch 40 min later → recovery prompt', async () => {
  const dataDir = freshDataDir();
  s = await launch({ dataDir });
  await expect.poll(async () => (await host(s!)).engine.mode).toBe('working');
  await s.debug.flush();
  s.db().close();
  // Hard-kill the whole process tree (no graceful quit, no final heartbeat).
  execSync(`taskkill /F /T /PID ${s.app.process().pid}`, { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  s = await launch({ dataDir, now: '2026-11-24T11:40:00' });
  await expect(title(s.prompt)).toHaveText("Spyder wasn't running from 11:00 to 11:40");
  expect(await promptVisible(s)).toBe(true);
  await shot(s.prompt, 'prompt-recovery');
  await s.prompt.getByRole('button', { name: 'Not working' }).click();
  // The 40 min Spyder wasn't running don't count toward a check-in (P48), so nothing follows.
  await expect.poll(() => promptVisible(s!)).toBe(false);
  expect((await host(s)).engine.prompts).toEqual([]);
  expect(s.db().prepare('SELECT reason, classification FROM away_periods').get()).toMatchObject({
    reason: 'not_running',
    classification: 'not_working',
  });
});

test('6. position persists; hide and hotkey', async () => {
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

test('7a. distraction flag and toast; break end prompt', async () => {
  s = await launch({ scale: 1 });
  await expect.poll(async () => (await host(s!)).engine.mode).toBe('working');
  const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', title: 'Lofi - YouTube', browser: 'chrome' as const };
  expect(await s.debug.injectActivity(yt)).toBe('distracting');
  await s.debug.advance(300);
  await s.debug.injectActivity(yt);
  const st = await host(s);
  expect(st.widgetVM.isDistracted).toBe(true);
  expect(st.toastCount).toBe(1);
  expect(s.db().prepare('SELECT target, continuous_sec FROM distraction_flags').get()).toMatchObject({
    target: 'youtube.com',
    continuous_sec: 300,
  });
  await expect(s.widget.getByTestId('pill')).toContainText(/distracted/i);
  await expect(s.widget.getByTestId('pill')).toContainText(/youtube\.com/i);
  await s.debug.injectActivity({ ...yt, exe: 'code.exe', appName: 'VS Code', domain: null, title: 'x', browser: null });

  // Break with a duration → breakEnd prompt.
  await startFromSidebar(s, { tab: 'Break', minutes: 15 });
  await s.debug.setScale(600);
  await expect(title(s.prompt)).toHaveText("Break's over (15m)", { timeout: 5000 });
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-breakEnd');
  await s.prompt.getByRole('button', { name: 'Back to work' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
});

test('7b. Start session from the sidebar while one runs; off hours → Keep working (P20, P50)', async () => {
  s = await launch({ scale: 1, now: '2026-11-24T16:50:00' });
  await startFromSidebar(s, { tab: 'Planned', name: 'Deep work', minutes: 25 });
  const d = s.dashboard;
  // Start session stays available while a session runs.
  await expect(d.getByTestId('sidebar-start')).toBeVisible();
  await startFromSidebar(s, { tab: 'Open', name: 'Email' });
  await expect.poll(async () => (await host(s!)).engine.current?.name).toBe('Email');
  expect(s.db().prepare("SELECT status FROM sessions WHERE name = 'Deep work'").get()).toMatchObject({ status: 'done' });

  await s.debug.setNow(new Date(2026, 10, 24, 17, 0, 5).getTime());
  await s.debug.tick();
  await expect(s.widget.getByTestId('pill')).toContainText('Off hours');
  await expect(d.getByTestId('sidebar-start')).toHaveCount(0);
  await d.getByTestId('keep-working').click();
  await expect.poll(async () => (await host(s!)).engine.mode).toBe('working');
  await expect(d.getByTestId('sidebar-start')).toBeVisible();
});

test('7c. bar style (default): label, sharp corners, dashboard button, inert cells, minimize, drag handle (P46, P49)', async () => {
  s = await launch({ scale: 1 });
  const bar = s.widget.getByTestId('pill');
  const d = s.dashboard;
  await expect(bar).toHaveAttribute('data-style', 'bar');
  await expect.poll(async () => (await widgetBounds(s!)).width).toBe(528); // 512 bar + margins (P49)
  expect(await bar.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  // Tue 11:00, work 10–17 → 14% of day; an unlabelled open session auto-started.
  await expect(s.widget.getByTestId('bar-day')).toContainText('14%');
  await expect(s.widget.getByTestId('bar-productive')).toContainText(/^\d+ min/);
  await expect(bar).toContainText(/session\s*elapsed/i);
  await expect(s.widget.getByTestId('bar-label')).toHaveCount(0);
  await shot(s.widget, 'widget-bar-open');

  // Everything drags except the two buttons; the cells are not click targets (P49).
  const region = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region');
  expect(await bar.evaluate(region)).toBe('drag');
  for (const id of ['pill-body', 'bar-productive', 'bar-day']) expect(await s.widget.getByTestId(id).evaluate(region)).not.toBe('no-drag');
  const dash = s.widget.getByRole('button', { name: 'Open dashboard' });
  const mini = s.widget.getByRole('button', { name: 'Minimize' });
  expect(await dash.evaluate(region)).toBe('no-drag');
  expect(await mini.evaluate(region)).toBe('no-drag');
  await expect(s.widget.getByTestId('drag-handle')).toBeVisible();
  // The dashboard button is the left-most thing in the bar.
  expect((await dash.boundingBox())!.x).toBeLessThan((await s.widget.getByTestId('pill-body').boundingBox())!.x);

  // Clicking a cell does nothing.
  expect((await s.debug.state()).dashboardVisible).toBe(false);
  for (const id of ['pill-body', 'bar-productive', 'bar-day']) await s.widget.getByTestId(id).click();
  await s.widget.waitForTimeout(500);
  expect((await s.debug.state()).dashboardVisible).toBe(false);
  await expect(s.widget.getByTestId('panel')).toHaveCount(0);
  expect((await widgetBounds(s)).height).toBe(50);

  // The dashboard button opens Today.
  await d.evaluate(() => (location.hash = '/dashboard/week'));
  await dash.click();
  await expect.poll(async () => (await s!.debug.state()).dashboardVisible).toBe(true);
  await expect.poll(() => d.evaluate(() => location.hash)).toBe('#/dashboard/today');

  // A label replaces the caption and wraps onto two lines; … only past the second (P47).
  const id = (await host(s)).engine.current!.id;
  const label = s.widget.getByTestId('bar-label');
  const lines = () => label.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  const clipped = () => label.evaluate((el) => el.scrollHeight > el.clientHeight + 2); // 1 px of descender rounding
  await s.widget.evaluate((sid) => window.spyder.label(sid, 'Code review', null), id);
  await expect(label).toHaveText('Code review');
  await s.widget.evaluate((sid) => window.spyder.label(sid, 'Writing weekly report', null), id);
  await expect(label).toHaveText('Writing weekly report');
  // Typeset exactly like the other captions (P49).
  const type = (el: Element) => {
    const c = getComputedStyle(el);
    return [c.fontFamily, c.fontSize, c.fontWeight, c.textTransform, c.letterSpacing, c.lineHeight, c.color];
  };
  const other = s.widget.getByTestId('bar-productive').locator('.caps span').first();
  expect(await label.evaluate(type)).toEqual(await other.evaluate(type));
  expect(await lines()).toBe(2);
  expect(await clipped()).toBe(false);
  await expect(bar).not.toContainText(/elapsed/i);
  await shot(s.widget, 'widget-bar-labelled');
  await s.widget.evaluate((sid) => window.spyder.label(sid, 'Quarterly planning with the whole design team', null), id);
  await expect.poll(lines).toBe(2);
  expect(await clipped()).toBe(true);
  await shot(s.widget, 'widget-bar-label-clamped');
  // Cells are content-sized and spread evenly (P49): equal gaps between, half-gaps at the ends,
  // and even a full two-line label leaves clear space between cells.
  const gaps = await s.widget.getByTestId('pill-body').evaluate((el) => {
    const row = el.parentElement!;
    const r = row.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(row).paddingLeft);
    const b = [...row.children].map((c) => c.getBoundingClientRect());
    return [b[0].left - r.left - pad, b[1].left - b[0].right, b[2].left - b[1].right, r.right - pad - b[2].right];
  });
  expect(Math.abs(gaps[1] - gaps[2])).toBeLessThan(2);
  expect(Math.abs(gaps[0] * 2 - gaps[1])).toBeLessThan(2);
  expect(Math.abs(gaps[3] * 2 - gaps[1])).toBeLessThan(2);
  expect(gaps[1]).toBeGreaterThanOrEqual(12);
  await s.widget.evaluate((sid) => window.spyder.label(sid, 'Writing weekly report', null), id);

  // Distracted: still the label, now red.
  const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', title: 'Lofi - YouTube', browser: 'chrome' as const };
  await s.debug.injectActivity(yt);
  await s.debug.advance(300);
  await s.debug.injectActivity(yt);
  await expect(s.widget.getByTestId('timer')).toHaveClass(/text-red/);
  await expect(s.widget.getByTestId('bar-label')).toHaveClass(/text-red/);
  await expect(s.widget.getByTestId('bar-label')).toHaveText('Writing weekly report');
  await s.widget.waitForTimeout(2200);
  await shot(s.widget, 'widget-bar-distracted');
  await s.debug.injectActivity({ ...yt, exe: 'code.exe', appName: 'VS Code', domain: null, title: 'x', browser: null });

  // Sidebar controls: Pause · Break · Done → paused: Resume · Done.
  const ctl = d.getByTestId('session-controls');
  await expect(ctl.getByRole('button')).toHaveText(['Pause', 'Break', 'Done']);
  await shot(d, 'sidebar-controls');
  await ctl.getByRole('button', { name: 'Pause' }).click();
  await expect(s.widget.getByTestId('timer')).toHaveClass(/text-break/);
  await expect(s.widget.getByTestId('bar-label')).toHaveText('Writing weekly report');
  await expect(s.widget.getByTestId('bar-label')).toHaveClass(/text-break/);
  await expect(ctl.getByRole('button')).toHaveText(['Resume', 'Done']);
  await shot(s.widget, 'widget-bar-paused');
  await ctl.getByRole('button', { name: 'Resume' }).click();
  await expect(ctl.getByRole('button')).toHaveText(['Pause', 'Break', 'Done']);

  // Break opens the start form on the Break tab; on a break the block offers End break.
  await ctl.getByRole('button', { name: 'Break' }).click();
  await expect.poll(async () => (await host(s!)).startOpen).toBe(true);
  await expect(s.prompt.getByRole('tab', { name: 'Break' })).toHaveAttribute('aria-selected', 'true');
  await s.prompt.getByRole('button', { name: 'Start ▶' }).click();
  await expect.poll(async () => (await host(s!)).engine.current?.kind).toBe('break');
  await expect(ctl.getByRole('button')).toHaveText(['End break']);
  await ctl.getByRole('button', { name: 'End break' }).click();
  await expect.poll(async () => (await host(s!)).engine.current?.kind ?? null).not.toBe('break');

  // Minimize hides the bar; Show widget brings it back.
  await s.widget.getByRole('button', { name: 'Minimize' }).click();
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(false);
  await d.getByRole('button', { name: 'Show widget' }).click();
  await expect.poll(async () => (await s!.debug.state()).widgetVisible).toBe(true);

  // Off hours: the words stay; no session controls.
  await s.debug.setNow(new Date(2026, 10, 24, 17, 0, 5).getTime());
  await s.debug.tick();
  await expect(bar).toContainText('Off hours');
  await expect(bar).toContainText(/workday\s*done/i);
  await expect(s.widget.getByTestId('bar-day')).toContainText('100%');
  await expect(ctl).toHaveCount(0);
  await shot(s.widget, 'widget-bar-offhours');
});
