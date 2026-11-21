// IPC contract (plan §11). Channels are `spyder:<method>`. Later phases add the remaining data handlers.
import { ipcMain } from 'electron';
import type { Settings } from '../core/settings';
import type { Answer, EngineError, Kind, StartInput } from '../core/types';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import type { EngineHost } from './engineHost';
import { registerHotkey } from './hotkey';
import { loadSettings, saveSettings } from './settings';
import { hideWidget, openDashboard, resizePrompt, setWidgetLayout, type WidgetLayout } from './windows';

const result = (err: EngineError | null) => err ?? { ok: true as const };

export function registerIpc(ctx: AppCtx, host: EngineHost): void {
  const h = (method: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(`spyder:${method}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));

  // Settings
  h('getSettings', () => ({ ...ctx.settings, hotkeyOk: ctx.hotkeyOk, dataDir: ctx.dataDir }));
  h('setSettings', (partial: Partial<Settings>) => {
    saveSettings(ctx.db, partial);
    ctx.settings = loadSettings(ctx.db);
    if ('hotkey' in partial) registerHotkey(ctx);
    if ('widgetStyle' in partial) setWidgetLayout(ctx);
    host.push();
    return { ...ctx.settings, hotkeyOk: ctx.hotkeyOk, dataDir: ctx.dataDir };
  });

  // Engine
  h('getWidget', () => host.widget());
  h('start', (input: StartInput) => host.start(input));
  h('done', () => result(host.dispatch({ type: 'DONE' })));
  h('extend', (sec: number) => result(host.dispatch({ type: 'EXTEND', sec })));
  h('pause', () => result(host.dispatch({ type: 'PAUSE' })));
  h('resume', () => result(host.dispatch({ type: 'RESUME' })));
  h('label', (sessionId: string, name: string, projectId: string | null) =>
    result(host.dispatch({ type: 'LABEL', sessionId, name, projectId })),
  );
  h('keepWorking', () => result(host.dispatch({ type: 'KEEP_WORKING' })));

  // Prompts
  h('getPrompt', () => host.promptState());
  h('answer', (promptId: string, a: Answer) => host.answer(promptId, a));
  h('openStart', (tab?: Kind) => host.openStart(tab));
  h('closeStart', () => host.closeStart());

  // Data
  h('nameSuggestions', (prefix: string) => repo.nameSuggestions(ctx.db, prefix));
  h('listProjects', () => repo.listProjects(ctx.db));
  h('saveProject', (p: { id?: string; name: string; color?: string }) => repo.saveProject(ctx.db, p, ctx.clock.now()));

  // Windows
  h('hideWidget', () => hideWidget(ctx));
  h('openDashboard', (route?: string) => openDashboard(ctx, route));
  h('widgetLayout', (layout: WidgetLayout) => setWidgetLayout(ctx, layout));
  h('resizePrompt', (height: number) => resizePrompt(ctx, height));
}
