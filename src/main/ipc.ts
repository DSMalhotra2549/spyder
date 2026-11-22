// IPC contract (plan §11). Channels are `spyder:<method>`. Later phases add the remaining data handlers.
import { app, dialog, ipcMain, shell } from 'electron';
import { join, parse } from 'node:path';
import type { Rule } from '../core/categorize';
import { cleanSettings, type ScheduleRow } from '../core/settings';
import type { DayOverride } from '../core/schedule';
import type { TitlePattern } from '../core/titlePatterns';
import type { EngineError } from '../core/types';
import type { BlockAnswer } from '../preload/api';
import { applyAutostart } from './autostart';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import { exportRange } from './export';
import type { EngineHost } from './engineHost';
import { registerHotkey } from './hotkey';
import * as report from './report';
import { dateKey } from '../core/schedule';
import { loadSettings, saveSettings } from './settings';
import { BlockEditor } from './blockEdit';
import { applyTheme } from './theme';
import { hideWidget, openDashboard, resizePrompt, showWidget } from './windows';

const documentsDir = () => app.getPath('documents');
const result = (err: EngineError | null) => err ?? { ok: true as const };

export interface IpcHooks {
  /** The tracker re-reads title patterns after one changes. */
  titlePatternsChanged: () => void;
}

export function registerIpc(ctx: AppCtx, host: EngineHost, hooks: IpcHooks): void {
  const h = (method: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(`spyder:${method}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));

  // Settings
  h('getSettings', () => ({ ...ctx.settings, hotkeyOk: ctx.hotkeyOk, dataDir: ctx.dataDir, today: dateKey(ctx.clock.now()) }));
  h('setSettings', (raw: Record<string, unknown>) => {
    const partial = cleanSettings(raw);
    saveSettings(ctx.db, partial);
    ctx.settings = loadSettings(ctx.db);
    if ('hotkey' in partial) registerHotkey(ctx);
    if ('autostart' in partial) applyAutostart(ctx);
    if ('theme' in partial) applyTheme(ctx);
    if ('goalSec' in partial || 'appPercentScope' in partial) host.reloadRules();
    if (partial.blockLengthSec !== undefined) host.setLength(partial.blockLengthSec);
    host.push();
    return { ...ctx.settings, hotkeyOk: ctx.hotkeyOk, dataDir: ctx.dataDir, today: dateKey(ctx.clock.now()) };
  });
  h('getSchedule', () => ({ rows: repo.loadSchedule(ctx.db).sort((a, b) => a.weekday - b.weekday), overrides: Object.fromEntries(repo.loadOverrides(ctx.db)) }));
  h('setSchedule', (rows: ScheduleRow[]) => {
    repo.saveSchedule(ctx.db, rows.filter((r) => r.weekday >= 0 && r.weekday <= 6 && r.startMin >= 0 && r.endMin <= 1440 && r.startMin < r.endMin));
    host.scheduleChanged();
  });
  h('setDayOverride', (date: string, o: Omit<DayOverride, 'date'> | null) => {
    if (o) {
      if (!(o.startMin >= 0 && o.endMin <= 1440 && o.startMin < o.endMin)) return;
      repo.upsertOverride(ctx.db, { ...o, date });
    } else repo.deleteOverride(ctx.db, date);
    host.scheduleChanged();
  });
  h('openDataFolder', () => shell.openPath(ctx.dataDir));

  // Export (P28): one .xlsx, plus the same sheets as CSVs in a folder next to it.
  h('exportData', async (o: { from: string; to: string; xlsxPath?: string; csvDir?: string }) => {
    const ok = /^\d{4}-\d{2}-\d{2}$/;
    if (!ok.test(o.from) || !ok.test(o.to) || o.from > o.to) return { error: 'range' as const };
    // Only the e2e tests pass paths; the app always asks.
    let xlsxPath = ctx.debug ? (o.xlsxPath ?? process.env.SPYDER_EXPORT_PATH) : undefined;
    if (!xlsxPath) {
      const parent = ctx.dashboard ?? undefined;
      const opts = {
        title: 'Export to Excel',
        defaultPath: join(documentsDir(), `Spyder ${o.from} to ${o.to}.xlsx`),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      };
      const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { canceled: true as const };
      xlsxPath = r.filePath;
    }
    const p = parse(xlsxPath);
    const csvDir = (ctx.debug ? o.csvDir : undefined) ?? join(p.dir, `${p.name} (CSV)`);
    await exportRange(ctx.db, { from: o.from, to: o.to, xlsxPath, csvDir }, ctx.clock.now(), ctx.settings);
    return { ok: true as const, xlsxPath, csvDir };
  });
  h('showInFolder', (path: string) => shell.showItemInFolder(path));

  // The block loop (P58–P62)
  h('getWidget', () => host.widget());
  h('start', (lengthSec: number) => host.start(lengthSec));
  h('stop', () => result(host.dispatch({ type: 'STOP' })));
  h('setBlockLength', (lengthSec: number) => host.setLength(lengthSec));
  h('dismissReminder', () => result(host.dispatch({ type: 'DISMISS_REMINDER' })));
  h('keepWorking', () => result(host.dispatch({ type: 'KEEP_WORKING' })));
  h('answerBlocks', (answers: BlockAnswer[]) => host.answer(answers));
  h('answerSuggestions', (prefix: string) => repo.answerSuggestions(ctx.db, prefix));
  h('getPrompt', () => host.promptState());

  // Editing blocks after the fact (P64)
  const editor = new BlockEditor(ctx, host);
  h('deleteBlocks', (ids: string[]) => editor.delete(ids));
  h('mergeBlocks', (ids: string[], answer: string | null) => editor.merge(ids, answer));
  h('undoEdit', (undoId: string) => editor.undo(undoId));

  // Data
  h('getDay', (date?: string) => report.dayVM(ctx.db, date, ctx.clock.now(), ctx.settings));
  h('getRange', (from: string, to: string) => report.rangeVM(ctx.db, from, to, ctx.clock.now(), ctx.settings));
  h('listUncategorized', (date?: string) => report.listUncategorized(ctx.db, date, ctx.clock.now(), ctx.settings));
  h('listRules', () => repo.listRules(ctx.db));
  h('saveRule', (r: { id?: string; matchType: Rule['matchType']; pattern: string; category: Rule['category'] }) => {
    repo.saveRule(ctx.db, r, ctx.clock.now());
    host.reloadRules();
  });
  h('deleteRule', (id: string) => {
    repo.deleteRule(ctx.db, id);
    host.reloadRules();
  });
  h('listTitlePatterns', () => repo.listTitlePatternRows(ctx.db));
  h('saveTitlePattern', (p: TitlePattern & { id?: string }) => {
    repo.saveTitlePattern(ctx.db, p);
    hooks.titlePatternsChanged();
    host.reloadRules();
  });
  h('deleteTitlePattern', (id: string) => {
    repo.deleteTitlePattern(ctx.db, id);
    hooks.titlePatternsChanged();
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

  // Windows
  h('hideWidget', () => hideWidget(ctx));
  h('showWidget', () => showWidget(ctx));
  h('openDashboard', (route?: string) => openDashboard(ctx, route));
  h('resizePrompt', (height: number) => resizePrompt(ctx, height));
}
