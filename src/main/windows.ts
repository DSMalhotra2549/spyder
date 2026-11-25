import { BrowserWindow, screen } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { helperPath } from './capture/chromeUrl';
import type { AppCtx } from './context';
import { rendererUrl } from './paths';
import { saveSettings } from './settings';
import { applyStyleTo, titleBarOverlay } from './theme';

/**
 * e2e only (SPYDER_QUIET with SPYDER_DEBUG): windows are invisible, click-through and never take focus, and no
 * system toasts show, so a test run doesn't take over the screen. Playwright drives the pages without OS focus.
 */
export const QUIET = process.env.SPYDER_DEBUG === '1' && process.env.SPYDER_QUIET === '1';

/** The bar (P49): 512 × 34 plus an 8 px margin on every side (design/DESIGN.md §2). */
export const WIDGET_SIZE = { width: 528, height: 50 } as const;

/** Prompt card is 420 wide plus an 8 px shadow margin each side (DESIGN.md §3). */
export const PROMPT_WIDTH = 436;

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The widget plays the ring and the prompt must update while unfocused.
  backgroundThrottling: false,
});

function load(ctx: AppCtx, win: BrowserWindow, hash: string): void {
  win.webContents.on('did-finish-load', () => void applyStyleTo(ctx, win)); // P78, P93
  const r = rendererUrl(hash);
  if (r.url) void win.loadURL(r.url);
  else void win.loadFile(r.file!, { hash: r.hash });
}

/** Top-center of the primary display, or the saved position if it's still on a connected display. */
export function widgetPosition(
  saved: { x: number; y: number } | null,
  size: { width: number; height: number },
): { x: number; y: number } {
  if (saved) {
    const d = screen.getDisplayMatching({ ...saved, ...size });
    const a = d.workArea;
    const inside =
      saved.x >= a.x - size.width / 2 &&
      saved.y >= a.y &&
      saved.x + size.width / 2 <= a.x + a.width &&
      saved.y + size.height / 2 <= a.y + a.height;
    if (inside) return saved;
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(a.x + (a.width - size.width) / 2), y: a.y + 8 };
}

export function createWidget(ctx: AppCtx): BrowserWindow {
  const size = WIDGET_SIZE;
  const pos = widgetPosition(ctx.settings.widgetPos, size);
  const win = new BrowserWindow({
    ...size,
    ...pos,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Spyder',
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'floating');
  let t: NodeJS.Timeout | undefined;
  // 'move' (debounced) rather than 'moved': it also fires for programmatic moves.
  win.on('move', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      ctx.settings.widgetPos = { x, y };
      saveSettings(ctx.db, { widgetPos: ctx.settings.widgetPos });
    }, 500);
  });
  win.once('ready-to-show', () => win.showInactive());
  win.on('close', (e) => {
    if (!ctx.quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  load(ctx, win, '/widget');
  return win;
}

export function createPrompt(ctx: AppCtx): BrowserWindow {
  const win = new BrowserWindow({
    width: PROMPT_WIDTH,
    height: 220,
    show: false,
    frame: false,
    // Glass: Windows 11 acrylic behind the card; Windows draws the rounded corners and the shadow.
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    hasShadow: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Spyder',
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'floating');
  // Prompts never auto-dismiss (P22): closing only hides, and the engine shows it again if needed.
  win.on('close', (e) => {
    if (!ctx.quitting) e.preventDefault();
  });
  load(ctx, win, '/prompt');
  return win;
}

/** Below the widget if it fits, else centred on the widget's display (plan §12). */
function promptPosition(ctx: AppCtx, height: number): { x: number; y: number } {
  const w = ctx.widget;
  const disp = w && w.isVisible() ? screen.getDisplayMatching(w.getBounds()) : screen.getPrimaryDisplay();
  const a = disp.workArea;
  if (w && w.isVisible()) {
    const b = w.getBounds();
    const x = Math.min(Math.max(a.x, b.x), a.x + a.width - PROMPT_WIDTH);
    const y = b.y + b.height - 4;
    if (y + height <= a.y + a.height) return { x, y };
  }
  return { x: Math.round(a.x + (a.width - PROMPT_WIDTH) / 2), y: Math.round(a.y + (a.height - height) / 2) };
}

export function showPrompt(ctx: AppCtx): void {
  const p = ctx.prompt;
  if (!p || p.isDestroyed()) return;
  const [, h] = p.getSize();
  const pos = promptPosition(ctx, h);
  p.setPosition(pos.x, pos.y);
  if (QUIET) return p.showInactive();
  p.show();
  p.setAlwaysOnTop(true, 'floating');
  p.focus();
  takeForeground(p);
}

/**
 * P71: Windows won't let a background app take keyboard focus while the user types elsewhere, so
 * focus() alone leaves the typing in the other app. The helper shares that app's input to hand it over.
 */
function takeForeground(win: BrowserWindow): void {
  const exe = helperPath();
  if (process.platform !== 'win32' || !existsSync(exe)) return;
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE().toString();
  spawn(exe, ['focus', hwnd], { windowsHide: true }).on('error', (e) => console.warn('[spyder] focus helper', e.message));
}

export function hidePrompt(ctx: AppCtx): void {
  const p = ctx.prompt;
  if (p && !p.isDestroyed() && p.isVisible()) p.hide();
}

export function resizePrompt(ctx: AppCtx, height: number): void {
  const p = ctx.prompt;
  if (!p || p.isDestroyed()) return;
  const h = Math.max(80, Math.min(720, Math.ceil(height)));
  const b = p.getBounds();
  if (b.height === h) return;
  p.setBounds({ x: b.x, y: b.y, width: PROMPT_WIDTH, height: h });
  if (p.isVisible()) {
    const pos = promptPosition(ctx, h);
    p.setPosition(pos.x, pos.y);
  }
}

export function createDashboard(ctx: AppCtx, route = 'today'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Spyder',
    // Glass prototype: Windows 11 acrylic shows through wherever the page is transparent (the sidebar).
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    // No title bar: the glass runs to the top; Windows still draws min/max/close over it.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  win.on('close', (e) => {
    if (!ctx.quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  load(ctx, win, `/dashboard/${route}`);
  return win;
}

export function showWidget(ctx: AppCtx): void {
  const w = ctx.widget;
  if (!w || w.isDestroyed()) return;
  w.showInactive();
  w.setAlwaysOnTop(true, 'floating');
}

export function hideWidget(ctx: AppCtx): void {
  ctx.widget?.hide();
}

/** P83: on top, the bar's minimize drops it behind every window; already behind, it goes to the tray. */
export function minimizeWidget(ctx: AppCtx): void {
  const w = ctx.widget;
  if (!w || w.isDestroyed()) return;
  if (!w.isAlwaysOnTop()) return hideWidget(ctx);
  w.setAlwaysOnTop(false);
  w.blur(); // hands focus to the window below, so the app you were in stays in front
  sendToBack(w);
}

/** The helper puts the window at the bottom of the z-order; Electron has no API for it (ADR-0008). */
function sendToBack(win: BrowserWindow): void {
  const exe = helperPath();
  if (process.platform !== 'win32' || !existsSync(exe)) return;
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE().toString();
  spawn(exe, ['back', hwnd], { windowsHide: true }).on('error', (e) => console.warn('[spyder] back helper', e.message));
}

/** The hotkey hides the bar when it's on top, and brings it back on top when it's hidden or behind (P83). */
export function toggleWidget(ctx: AppCtx): void {
  const w = ctx.widget;
  if (w?.isVisible() && w.isAlwaysOnTop()) hideWidget(ctx);
  else showWidget(ctx);
}

export function openDashboard(ctx: AppCtx, route?: string): void {
  const d = ctx.dashboard;
  if (!d || d.isDestroyed()) return;
  if (route) {
    // Set the hash directly: a message could arrive before the renderer subscribes (slow first load).
    const go = () => void d.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`/dashboard/${route}`)}`);
    if (d.webContents.isLoading()) d.webContents.once('did-finish-load', go);
    else go();
  }
  if (QUIET) return d.showInactive();
  d.show();
  d.focus();
}
