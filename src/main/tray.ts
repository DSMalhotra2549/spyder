import { Menu, Tray, nativeImage, app } from 'electron';
import { join } from 'node:path';
import type { AppCtx } from './context';
import { resourcesDir } from './paths';
import { openDashboard, showWidget } from './windows';

export interface TrayHandlers {
  startSession: () => void;
  togglePause: () => void;
  pauseLabel: () => string;
}

let menuLabels: string[] = [];

export function createTray(ctx: AppCtx, h: TrayHandlers): Tray {
  const img = nativeImage.createFromPath(join(resourcesDir(), 'icon.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(img);
  tray.setToolTip('Spyder');
  const rebuild = () => {
    const template = [
      { label: 'Show widget', click: () => showWidget(ctx) },
      { label: 'Open dashboard', click: () => openDashboard(ctx) },
      { type: 'separator' as const },
      { label: 'Start session…', click: h.startSession },
      { label: h.pauseLabel(), click: h.togglePause },
      { type: 'separator' as const },
      { label: 'Quit', click: () => app.quit() },
    ];
    menuLabels = template.flatMap((t) => ('label' in t && t.label ? [t.label] : []));
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  rebuild();
  tray.on('click', () => showWidget(ctx));
  tray.on('right-click', rebuild);
  return tray;
}

let lastTooltip = 'Spyder';
export function setTrayTooltip(ctx: AppCtx, text: string): void {
  if (text === lastTooltip || !ctx.tray) return;
  lastTooltip = text;
  ctx.tray.setToolTip(text);
}

export function trayInfo(ctx: AppCtx): { exists: boolean; tooltip: string; menu: string[] } {
  return { exists: !!ctx.tray && !ctx.tray.isDestroyed(), tooltip: lastTooltip, menu: menuLabels };
}
