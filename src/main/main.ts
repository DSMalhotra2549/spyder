import { app, Notification } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClock, parseLocalIso } from '../core/clock';
import type { AppCtx } from './context';
import { Db } from './db/db';
import { migrate } from './db/migrate';
import { MIGRATIONS } from './db/migrations';
import { seedDefaults } from './db/seedDefaults';
import { addDebugHook, addDebugState, registerDebug } from './debug';
import { EngineHost, type ActivitySample } from './engineHost';
import { registerHotkey } from './hotkey';
import { startIdle } from './idle';
import { registerIpc } from './ipc';
import { loadSettings } from './settings';
import { createTray } from './tray';
import { createDashboard, createPrompt, createWidget, showWidget } from './windows';

// Must happen before whenReady (plan §3).
app.setName('Spyder');
app.setAppUserModelId('com.spyder.app');
// The widget plays the ring chime without a user gesture (plan §12).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const dataDir = process.env.SPYDER_DATA_DIR ?? join(app.getPath('appData'), 'Spyder');
mkdirSync(dataDir, { recursive: true });
// Keep Chromium profile + single-instance lock inside the data dir so test instances are isolated.
app.setPath('userData', join(dataDir, 'electron'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

async function boot(): Promise<void> {
  console.log(`[spyder] node ${process.versions.node}, electron ${process.versions.electron}, data ${dataDir}`);
  const clock = createClock({
    origin: parseLocalIso(process.env.SPYDER_NOW),
    scale: Number(process.env.SPYDER_CLOCK_SCALE ?? 1),
    realNow: Date.now,
  });
  const db = new Db(join(dataDir, 'spyder.db'));
  migrate(db, MIGRATIONS, clock.now());
  seedDefaults(db, clock.now());

  const ctx: AppCtx = {
    dataDir,
    db,
    clock,
    settings: loadSettings(db),
    debug: process.env.SPYDER_DEBUG === '1',
    quitting: false,
    widget: null,
    dashboard: null,
    prompt: null,
    tray: null,
    hotkeyOk: false,
  };

  app.on('second-instance', () => showWidget(ctx));
  app.on('before-quit', () => {
    ctx.quitting = true;
  });
  app.on('window-all-closed', () => {
    // Stay alive in the tray; only Quit exits.
  });
  const host = new EngineHost(ctx);
  app.on('will-quit', () => {
    try {
      host.stop();
      db.close();
    } catch {
      // already closed
    }
  });

  await app.whenReady();
  registerIpc(ctx, host);
  registerDebug(ctx);
  addDebugState('host', () => host.debugState());
  addDebugHook('injectActivity', (s: ActivitySample) => host.feedSample(s));
  addDebugHook('setScale', (scale: number) => ctx.clock.setScale(scale));
  addDebugHook('tick', () => host.dispatch({ type: 'TICK' }));
  addDebugHook('flush', () => host.saveHeartbeat());
  ctx.widget = createWidget(ctx);
  ctx.dashboard = createDashboard(ctx);
  ctx.prompt = createPrompt(ctx);
  ctx.tray = createTray(ctx, {
    startSession: () => host.openStart(),
    togglePause: () => host.togglePause(),
    pauseLabel: () => (host.state.paused ? 'Resume' : 'Pause'),
  });
  startIdle(ctx, host);
  host.boot();
  if (!registerHotkey(ctx)) console.warn(`[spyder] hotkey ${ctx.settings.hotkey} is taken`);
  if (!Notification.isSupported()) console.warn('[spyder] notifications not supported');
}
