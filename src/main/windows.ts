import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { AppCtx } from './context';
import { rendererUrl } from './paths';
import { saveSettings } from './settings';

/** Window sizes per design/DESIGN.md §2 (content + 8 px shadow margin). */
export const WIDGET_SIZE = {
  full: { collapsed: { width: 336, height: 80 }, expanded: { width: 336, height: 196 } },
  compact: { collapsed: { width: 192, height: 56 }, expanded: { width: 336, height: 172 } },
} as const;

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
});

function load(win: BrowserWindow, hash: string): void {
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
  const size = WIDGET_SIZE[ctx.settings.widgetStyle].collapsed;
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
  win.on('moved', () => {
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
  load(win, '/widget');
  return win;
}

export function createDashboard(ctx: AppCtx, route = 'today'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Spyder',
    backgroundColor: '#0E0E12',
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  win.on('close', (e) => {
    if (!ctx.quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  load(win, `/dashboard/${route}`);
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

export function toggleWidget(ctx: AppCtx): void {
  if (ctx.widget?.isVisible()) hideWidget(ctx);
  else showWidget(ctx);
}

export function openDashboard(ctx: AppCtx, route?: string): void {
  const d = ctx.dashboard;
  if (!d || d.isDestroyed()) return;
  if (route) d.webContents.send('spyder:navigate', route);
  d.show();
  d.focus();
}
