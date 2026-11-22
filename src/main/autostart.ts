// Start with Windows (plan Phase 8): HKCU\…\Run\Spyder. Only for the installed app, so dev and
// e2e runs never point the Run key at electron.exe.
import { app } from 'electron';
import type { AppCtx } from './context';

export function applyAutostart(ctx: AppCtx): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: ctx.settings.autostart, name: 'Spyder' });
}
