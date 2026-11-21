// IPC contract (plan §11). Channels are `spyder:<method>`. Later phases add the engine/data handlers.
import { ipcMain } from 'electron';
import type { Settings } from '../core/settings';
import type { AppCtx } from './context';
import { registerHotkey } from './hotkey';
import { loadSettings, saveSettings } from './settings';
import { hideWidget, openDashboard } from './windows';

export function registerIpc(ctx: AppCtx): void {
  ipcMain.handle('spyder:getSettings', () => ({ ...ctx.settings, hotkeyOk: ctx.hotkeyOk, dataDir: ctx.dataDir }));
  ipcMain.handle('spyder:setSettings', (_e, partial: Partial<Settings>) => {
    saveSettings(ctx.db, partial);
    ctx.settings = loadSettings(ctx.db);
    if ('hotkey' in partial) registerHotkey(ctx);
    return { ...ctx.settings, hotkeyOk: ctx.hotkeyOk };
  });
  ipcMain.handle('spyder:hideWidget', () => hideWidget(ctx));
  ipcMain.handle('spyder:openDashboard', (_e, route?: string) => openDashboard(ctx, route));
}
