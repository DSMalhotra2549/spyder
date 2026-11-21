import { globalShortcut } from 'electron';
import type { AppCtx } from './context';
import { toggleWidget } from './windows';

let registered: string | null = null;

export function hotkeyHandler(ctx: AppCtx): void {
  toggleWidget(ctx);
}

/** Registers the widget toggle hotkey. Returns false (no crash) if the combo is taken. */
export function registerHotkey(ctx: AppCtx): boolean {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  let ok: boolean;
  try {
    ok = globalShortcut.register(ctx.settings.hotkey, () => hotkeyHandler(ctx));
  } catch {
    ok = false; // invalid accelerator string
  }
  if (ok) registered = ctx.settings.hotkey;
  ctx.hotkeyOk = ok;
  return ok;
}
