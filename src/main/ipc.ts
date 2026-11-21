// IPC contract (plan §11). Channels are `spyder:<method>`. Later phases add the remaining data handlers.
import { ipcMain } from 'electron';
import type { Rule } from '../core/categorize';
import type { Settings } from '../core/settings';
import type { Answer, AwayClassification, EngineError, Kind, StartInput } from '../core/types';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import type { EngineHost } from './engineHost';
import { registerHotkey } from './hotkey';
import * as report from './report';
import { loadSettings, saveSettings } from './settings';
import { hideWidget, openDashboard, resizePrompt, setWidgetLayout, showWidget, type WidgetLayout } from './windows';

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
  h('getDay', (date?: string) => report.dayVM(ctx.db, date, ctx.clock.now(), ctx.settings));
  h('saveRule', (r: { matchType: Rule['matchType']; pattern: string; category: Rule['category'] }) => {
    repo.saveRule(ctx.db, r, ctx.clock.now());
    host.reloadRules();
  });

  // Review
  h('getReview', (date?: string) => report.reviewVM(ctx.db, date, ctx.clock.now(), ctx.settings));
  h('saveReviewItem', (it: Parameters<typeof report.saveReviewItem>[1]) => report.saveReviewItem(ctx.db, it, ctx.clock.now()));
  h('deleteReviewItem', (id: string) => report.deleteReviewItem(ctx.db, id));
  h('completeReview', (date: string) => report.completeReview(ctx.db, date, ctx.clock.now(), ctx.settings));
  h('listKpis', () => report.listKpis(ctx.db));
  h('saveKpi', (k: Parameters<typeof report.saveKpi>[1]) => report.saveKpi(ctx.db, k));
  h('setKpiValue', (date: string, kpiId: string, value: number | null) => report.setKpiValue(ctx.db, date, kpiId, value));
  h('classifyAway', (awayId: string, c: AwayClassification, label: string | null) => host.classifyAway(awayId, c, label));

  // Windows
  h('hideWidget', () => hideWidget(ctx));
  h('showWidget', () => showWidget(ctx));
  h('openDashboard', (route?: string) => openDashboard(ctx, route));
  h('widgetLayout', (layout: WidgetLayout) => setWidgetLayout(ctx, layout));
  h('resizePrompt', (height: number) => resizePrompt(ctx, height));
}
