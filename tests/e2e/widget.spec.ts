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

async function expand(l: Launched) {
  if (await l.widget.getByTestId('panel').isVisible()) return;
  const t = l.widget.getByTestId('title'); // full style; compact has no title in the pill
  await ((await t.count()) ? t : l.widget.getByTestId('pill-body')).click();
  await expect(l.widget.getByTestId('panel')).toBeVisible();
}

/** Opens the start popover from the widget, fills it and labels the boot session if asked (P21). */
async function startFromWidget(
  l: Launched,
  o: { tab: 'Planned' | 'Timed' | 'Open' | 'Break'; name?: string; minutes?: number; custom?: number },
  shotName?: string,
) {
  await expand(l);
  await l.widget.getByRole('button', { name: o.tab === 'Break' ? 'Break' : '▶ Start' }).click();
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
  await l.widget.keyboard.press('Escape'); // collapse (in real use the widget loses focus)
}

const title = (p: Page) => p.getByTestId('prompt-title');

test('1. planned countdown → timeUp → overtime → re-nag → +15', async () => {
  s = await launch({ scale: 600 });
  await shot(s.widget, 'widget-full-collapsed');
  await expand(s);
  await shot(s.widget, 'widget-full-expanded');
  await s.widget.keyboard.press('Escape');

  await startFromWidget(s, { tab: 'Planned', name: 'Replying to emails', minutes: 30 }, 'start-popover');
  const st = await host(s);
  expect(st.engine.current).toMatchObject({ kind: 'planned', name: 'Replying to emails' });
  // Labelled boot session got its name.
  expect(s.db().prepare("SELECT kind FROM sessions WHERE name = 'Setup'").get()).toMatchObject({ kind: 'open' });

  await expect(title(s.prompt)).toHaveText("Time's up: Replying to emails", { timeout: 5000 });
  expect(await promptVisible(s)).toBe(true);
  // Slow the clock to real time so the rest of the scenario is deterministic.
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-timeUp');
  await s.widget.waitForTimeout(1000);
  const timer = s.widget.getByTestId('timer');
  await expect(timer).toHaveText(/^\+\d\d:\d\d$/);
  await expect(timer).toHaveClass(/text-red/);
  await shot(s.widget, 'widget-full-overtime');

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
  s = await launch({ scale: 600 });
  await startFromWidget(s, { tab: 'Timed', custom: 10 });
  await expect(title(s.prompt)).toHaveText(/^What did you do for the last 1\dm\?$/, { timeout: 5000 });
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-label');
  await s.prompt.getByLabel('Session name').fill('Inbox zero');
  await s.prompt.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
  const row = s.db().prepare("SELECT kind, status, planned_sec FROM sessions WHERE name = 'Inbox zero'").get();
  expect(row).toMatchObject({ kind: 'timed', status: 'done', planned_sec: 600 });
});

test('3. open session → check-in → Log & continue', async () => {
  s = await launch({ scale: 600 });
  await expect(title(s.prompt)).toHaveText(/^What have you been doing for the last 3\dm\?$/, { timeout: 6000 });
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
  // Labelled check-in 30 min later.
  await s.debug.advance(1800);
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
  await shot(s.widget, 'widget-full-away');
  await s.debug.advance(4320);
  await s.debug.simulateResume();
  await expect(title(s.prompt)).toHaveText('You were away 1h 12m');
  await shot(s.prompt, 'prompt-away');
  await s.prompt.getByRole('button', { name: 'Break', exact: true }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
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
  // The next queued prompt (a check-in: 40 min since the last one) replaces it.
  await expect(title(s.prompt)).not.toHaveText(/wasn't running/);
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

test('7a. distracted, paused and break-end states', async () => {
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
  await expect(s.widget.getByTestId('title')).toContainText('⚠');
  await s.widget.waitForTimeout(2200); // let the one-off pulse finish
  await shot(s.widget, 'widget-full-distracted');

  // Compact style with the hover card.
  await s.widget.evaluate(() => window.spyder.setSettings({ widgetStyle: 'compact' }));
  await expect(s.widget.getByTestId('pill')).toHaveAttribute('data-style', 'compact');
  await expect.poll(async () => (await widgetBounds(s!)).width).toBe(192);
  await shot(s.widget, 'widget-compact-distracted');
  await s.widget.getByTestId('pill').hover();
  await expect(s.widget.getByTestId('hover-card')).toContainText('On youtube.com for 5 min');
  await shot(s.widget, 'widget-compact-hover');
  await s.widget.mouse.move(1, 1);
  await s.widget.getByTestId('pill-body').click();
  await expect(s.widget.getByTestId('panel')).toBeVisible();
  await expect.poll(async () => (await widgetBounds(s!)).width).toBe(336);
  await shot(s.widget, 'widget-compact-expanded');
  await s.widget.getByRole('button', { name: 'Switch to full' }).click();
  await expect(s.widget.getByTestId('pill')).toHaveAttribute('data-style', 'full');

  // Pause → break colours with PAUSED caption.
  await s.widget.evaluate(() => window.spyder.pause());
  await expect(s.widget.getByTestId('caption')).toContainText(/paused · untitled session/i);
  await s.widget.keyboard.press('Escape');
  await shot(s.widget, 'widget-full-paused');
  await s.widget.evaluate(() => window.spyder.resume());

  // Break with a duration → breakEnd prompt.
  await s.debug.setScale(600);
  await startFromWidget(s, { tab: 'Break', minutes: 15 });
  await expect(title(s.prompt)).toHaveText("Break's over (15m)", { timeout: 5000 });
  await s.debug.setScale(1);
  await shot(s.prompt, 'prompt-breakEnd');
  await s.prompt.getByRole('button', { name: 'Back to work' }).click();
  await expect.poll(() => promptVisible(s!)).toBe(false);
});

test('7b. compact running and off-hours states', async () => {
  s = await launch({ scale: 1, now: '2026-11-24T16:50:00' });
  await s.widget.evaluate(() => window.spyder.setSettings({ widgetStyle: 'compact' }));
  await startFromWidget(s, { tab: 'Planned', name: 'Deep work', minutes: 25 });
  await shot(s.widget, 'widget-compact-collapsed');
  await s.debug.setNow(new Date(2026, 10, 24, 17, 0, 5).getTime());
  await s.debug.tick();
  await expect(s.widget.getByTestId('pill')).toContainText('Off hours');
  await shot(s.widget, 'widget-compact-offhours');
  await s.widget.evaluate(() => window.spyder.setSettings({ widgetStyle: 'full' }));
  await expect(s.widget.getByTestId('title')).toHaveText('Workday done');
  await shot(s.widget, 'widget-full-offhours');
  await expand(s);
  await shot(s.widget, 'widget-full-offhours-expanded');
  await s.widget.getByTestId('panel').getByRole('button', { name: 'Keep working +30' }).click();
  await expect.poll(async () => (await host(s!)).engine.mode).toBe('working');
});
