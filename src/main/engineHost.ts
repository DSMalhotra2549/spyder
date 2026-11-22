// Engine host (ADR-0011): owns EngineState, ticks it with clock time, applies effects (DB, review, day
// overrides), writes answers, and pushes view models to the bar, the dashboard and the prompt window.
import { randomUUID } from 'node:crypto';
import { inLoop, initialState, reduce, widgetView } from '../core/blockEngine';
import { categorize, type ActivityCategory, type ActivityKey, type Rule } from '../core/categorize';
import { fmtClock } from '../core/format';
import { initialNudge, nudgeMessage, stepNudge, type NudgeState } from '../core/nudge';
import { accountView, reminderView, type PendingBlock, type PromptVM } from '../core/promptView';
import { addDays, dateKey, mergeOverride, minutesOfDay, startOfDay, workWindow, type DayOverride } from '../core/schedule';
import type { ScheduleRow } from '../core/settings';
import type { Ctx, Effect, EngineError, EngineEvent, EngineState } from '../core/types';
import type { WidgetPayload } from '../preload/api';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import { toast } from './notify';
import { refreshReview, summaryFor } from './report';
import { saveSettings, loadSettings } from './settings';
import { setTrayTooltip } from './tray';
import { hidePrompt, openDashboard, showPrompt } from './windows';

export type ActivitySample = ActivityKey & { appName?: string };

type DbEffect = Extract<Effect, { db: string }>;
type Result = { ok: true } | EngineError;

export class EngineHost {
  state: EngineState = initialState();
  toastCount = 0;
  private schedule: ScheduleRow[] = [];
  private overrides = new Map<string, DayOverride>();
  private rules: Rule[] = [];
  private nudge: NudgeState = initialNudge();
  private distracted = false;
  private distractTarget: string | null = null;
  /** Away intervals seen since launch: hints for accounting, never stored (P61). */
  private awayLog: { startMs: number; endMs: number }[] = [];
  /** Today's blocks waiting for an answer; recomputed when blocks or answers change. */
  private pending: PendingBlock[] = [];
  private pendingDirty = true;
  private pendingDay = '';
  private lastWidget = '';
  private lastPrompt = '';
  private lastPendingCount = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly app: AppCtx;

  constructor(app: AppCtx) {
    this.app = app;
    this.reloadSchedule();
    this.rules = repo.loadRules(app.db);
  }

  reloadSchedule(): void {
    this.schedule = repo.loadSchedule(this.app.db);
    this.overrides = repo.loadOverrides(this.app.db);
  }

  /** Settings page changed the schedule or an override: reload and let the engine react. */
  scheduleChanged(): void {
    this.reloadSchedule();
    this.productiveCache.atMs = Number.NaN;
    this.dispatch({ type: 'SCHEDULE_CHANGED' });
  }

  ctx(): Ctx {
    return {
      now: this.app.clock.now(),
      window: (ms) => workWindow(ms, this.schedule, this.overrides),
      settings: this.app.settings,
      newId: randomUUID,
    };
  }

  /** Restore from the heartbeat, then the tick loop. */
  boot(): void {
    this.dispatch({ type: 'BOOT', heartbeat: repo.loadHeartbeat(this.app.db) });
    const loop = () => {
      this.dispatch({ type: 'TICK' });
      // One real second normally; faster when the clock is sped up for tests, so timers stay accurate.
      const s = this.app.clock.scale;
      this.timer = setTimeout(loop, s > 1 ? Math.max(50, 1000 / s) : 1000);
    };
    this.timer = setTimeout(loop, 0);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.saveHeartbeat();
  }

  dispatch(ev: EngineEvent): EngineError | null {
    const ctx = this.ctx();
    const r = reduce(this.state, ev, ctx);
    if (r.error) return r.error;
    this.state = r.state;
    const dbFx = r.effects.filter((e): e is DbEffect => 'db' in e);
    repo.applyDbEffects(this.app.db, dbFx);
    for (const e of r.effects) {
      if ('openReview' in e) openDashboard(this.app, 'review');
      else if ('setDayOverride' in e) this.applyOverride(e.setDayOverride.date, e.setDayOverride.endMin, ctx);
      else if ('awayEnded' in e) this.awayLog.push(e.awayEnded);
      else if ('blockEnded' in e) this.productiveCache.atMs = Number.NaN;
    }
    if (dbFx.length) this.pendingDirty = true;
    if (r.effects.length) this.saveHeartbeat();
    this.push();
    return null;
  }

  private applyOverride(date: string, endMin: number, ctx: Ctx): void {
    const w = ctx.window(ctx.now);
    const cur = w ? { startMin: minutesOfDay(w.startMs), endMin: minutesOfDay(w.endMs) || 1440 } : null;
    const o: DayOverride = { date, ...mergeOverride(cur, minutesOfDay(ctx.now), endMin) };
    repo.upsertOverride(this.app.db, o);
    this.overrides.set(date, o);
  }

  saveHeartbeat(): void {
    repo.saveHeartbeat(this.app.db, this.app.clock.now(), this.state);
  }

  // ---- commands from IPC / tray ----------------------------------------------------
  private remember(lengthSec: number): void {
    if (this.app.settings.blockLengthSec === lengthSec) return;
    saveSettings(this.app.db, { blockLengthSec: lengthSec });
    this.app.settings = loadSettings(this.app.db);
  }

  start(lengthSec: number): Result {
    const err = this.dispatch({ type: 'START', lengthSec });
    if (err) return err;
    this.remember(lengthSec);
    this.push();
    return { ok: true };
  }

  /** The sidebar's length box: remembered, and used from the next block (P59). */
  setLength(lengthSec: number): Result {
    const err = this.dispatch({ type: 'SET_LENGTH', lengthSec });
    if (err) return err;
    this.remember(lengthSec);
    this.push();
    return { ok: true };
  }

  /**
   * Answers ended blocks (P60, P64): text, or null for Break. The running block has no answer yet.
   * Used by the prompt, Today and the review.
   */
  answer(answers: repo.BlockAnswer[]): Result {
    const clean: repo.BlockAnswer[] = [];
    const running = this.state.loop?.block.id;
    for (const a of answers) {
      const text = a.answer === null ? null : a.answer.trim();
      if (text === '') return { error: 'invalid', message: 'Say what you did, or pick Break' };
      if (a.id === running) return { error: 'invalid', message: 'The running block can’t be answered until it ends' };
      const row = this.app.db.get<{ status: string; deleted_ms: number | null }>('SELECT status, deleted_ms FROM sessions WHERE id = ?', a.id);
      if (!row || row.deleted_ms !== null) return { error: 'invalid', message: 'No such block' };
      clean.push({ id: a.id, answer: text });
    }
    repo.writeAnswers(this.app.db, clean);
    const dates = new Set(
      clean.map((a) => dateKey(this.app.db.get<{ s: number }>('SELECT started_ms AS s FROM sessions WHERE id = ?', a.id)!.s)),
    );
    for (const d of dates) refreshReview(this.app.db, d, this.app.clock.now(), this.app.settings);
    this.dataChanged();
    return { ok: true };
  }

  // ---- nudge (plan §8) ---------------------------------------------------------------
  feedSample(sample: ActivitySample, tsMs = this.app.clock.now()): ActivityCategory {
    const category = categorize(sample, this.rules);
    const target = sample.domain ?? sample.appName ?? sample.exe;
    const r = stepNudge(this.nudge, { tsMs, category, target, inWorkSession: inLoop(this.state) }, this.app.settings);
    this.nudge = r.state;
    this.distracted = r.isDistracted;
    if (category === 'distracting') this.distractTarget = target;
    if (r.nudge) {
      repo.insertFlag(this.app.db, { tsMs, sessionId: this.state.loop?.block.id ?? null, target: r.nudge.target, continuousSec: r.nudge.continuousSec });
      this.toastCount++;
      toast(nudgeMessage(r.nudge.target, r.nudge.continuousSec));
    }
    this.push();
    return category;
  }

  reloadRules(): void {
    this.rules = repo.loadRules(this.app.db);
    this.productiveCache.atMs = Number.NaN;
  }

  /** Blocks were edited outside the engine (P64): recompute and push. */
  dataChanged(): void {
    this.productiveCache.atMs = Number.NaN;
    this.pendingDirty = true;
    this.push();
  }

  // ---- view models ---------------------------------------------------------------------
  private productiveCache = { atMs: Number.NaN, sec: 0 };

  /** P25 productive time today (aggregate.ts), recomputed at most every 10 clock-seconds. */
  private productiveToday(now: number): number {
    const c = this.productiveCache;
    if (!(Math.abs(now - c.atMs) < 10_000) || dateKey(now) !== dateKey(c.atMs)) {
      c.atMs = now;
      c.sec = summaryFor(this.app.db, dateKey(now), now, this.app.settings).productiveSec;
    }
    return c.sec;
  }

  private awaySecIn(startMs: number, endMs: number, now: number): number {
    const spans = [...this.awayLog, ...(this.state.away ? [{ startMs: this.state.away.startMs, endMs: now }] : [])];
    let ms = 0;
    for (const a of spans) ms += Math.max(0, Math.min(a.endMs, endMs) - Math.max(a.startMs, startMs));
    return Math.round(ms / 1000);
  }

  /** Today's ended blocks without an answer, with their hints (P60). */
  pendingBlocks(): PendingBlock[] {
    const now = this.app.clock.now();
    const day = dateKey(now);
    if (this.pendingDirty || day !== this.pendingDay) {
      const from = startOfDay(now);
      this.pending = repo.pendingBlocks(this.app.db, from, addDays(from, 1)).map((b) => ({
        id: b.id,
        startMs: b.start_ms,
        endMs: b.end_ms,
        awaySec: this.awaySecIn(b.start_ms, b.end_ms, now),
        apps: repo.topApps(this.app.db, b.start_ms, b.end_ms),
      }));
      this.pendingDirty = false;
      this.pendingDay = day;
    }
    return this.pending;
  }

  widget(): WidgetPayload {
    const ctx = this.ctx();
    const vm = widgetView(this.state, ctx, {
      productiveTodaySec: this.productiveToday(ctx.now),
      goalSec: this.app.settings.goalSec,
      isDistracted: this.distracted && inLoop(this.state),
      pendingCount: this.pendingBlocks().length,
    });
    const ds = this.nudge.distractStartMs;
    return {
      ...vm,
      distractTarget: vm.isDistracted ? this.distractTarget : null,
      distractSec: vm.isDistracted && ds !== null ? Math.floor((ctx.now - ds) / 1000) : 0,
    };
  }

  promptState(): PromptVM | null {
    const pending = this.pendingBlocks();
    const canContinue = !this.state.loop && !!this.state.cut && dateKey(this.state.cut.atMs) === dateKey(this.app.clock.now());
    if (pending.length) return accountView(pending, repo.lastAnswer(this.app.db), canContinue);
    if (this.state.reminder) return reminderView(this.app.settings.blockLengthSec);
    return null;
  }

  push(): void {
    const w = this.widget();
    const wj = JSON.stringify(w);
    if (wj !== this.lastWidget) {
      this.lastWidget = wj;
      for (const win of [this.app.widget, this.app.dashboard]) {
        if (win && !win.isDestroyed()) win.webContents.send('spyder:widget', w);
      }
      const status = w.running ? `Block ${fmtClock(w.timerSec)}` : w.notStarted ? 'Not started' : 'Off hours';
      setTrayTooltip(this.app, `Spyder — ${status}`);
    }
    const p = this.promptState();
    const pj = JSON.stringify(p);
    if (pj !== this.lastPrompt) {
      const wasNull = this.lastPrompt === '' || this.lastPrompt === 'null';
      this.lastPrompt = pj;
      const count = p?.view === 'account' ? p.blocks.length : 0;
      const win = this.app.prompt;
      if (win && !win.isDestroyed()) win.webContents.send('spyder:prompt', p);
      // Pops on top when it appears and whenever another block ends (P60).
      if (p && (wasNull || count > this.lastPendingCount)) showPrompt(this.app);
      else if (!p) hidePrompt(this.app);
      this.lastPendingCount = count;
    }
  }

  debugState(): Record<string, unknown> {
    return {
      engine: this.state,
      toastCount: this.toastCount,
      widgetVM: this.widget(),
      promptState: this.promptState(),
      today: dateKey(this.app.clock.now()),
    };
  }
}
