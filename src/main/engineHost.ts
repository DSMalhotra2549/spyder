// Engine host (plan §4, Phase 3): owns EngineState, ticks it with clock time, applies effects
// (DB, ring, prompts, day overrides) and pushes view models to the widget and prompt windows.
import { randomUUID } from 'node:crypto';
import { categorize, type ActivityCategory, type ActivityKey, type Rule } from '../core/categorize';
import { initialNudge, nudgeMessage, stepNudge, type NudgeState } from '../core/nudge';
import { promptView, type SessionInfo } from '../core/promptView';
import { dateKey, mergeOverride, minutesOfDay, workWindow, type DayOverride } from '../core/schedule';
import { elapsedSec, initialState, inWorkSession, reduce, visiblePrompt, widgetView } from '../core/sessionEngine';
import type { ScheduleRow } from '../core/settings';
import { fmtClock } from '../core/format';
import type { Answer, AwayClassification, Ctx, Effect, EngineError, EngineEvent, EngineState, Kind, StartInput } from '../core/types';
import type { PromptWindowState, WidgetPayload } from '../preload/api';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import { toast } from './notify';
import { summaryFor } from './report';
import { setTrayTooltip } from './tray';
import { hidePrompt, openDashboard, showPrompt } from './windows';

export type ActivitySample = ActivityKey & { appName?: string };

type DbEffect = Extract<Effect, { db: string }>;

export class EngineHost {
  state: EngineState = initialState();
  ringCount = 0;
  toastCount = 0;
  startOpen = false;
  private startTab: Kind = 'planned';
  private schedule: ScheduleRow[] = [];
  private overrides = new Map<string, DayOverride>();
  private rules: Rule[] = [];
  private nudge: NudgeState = initialNudge();
  private distracted = false;
  private distractTarget: string | null = null;
  private lastWidget = '';
  private lastPrompt = '';
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

  /** Settings page changed the schedule or an override: reload and let the engine react (E19). */
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

  /** E1 on startup, then the tick loop. */
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
      if ('ring' in e) this.ring();
      else if ('openReview' in e) openDashboard(this.app, 'review');
      else if ('setDayOverride' in e) this.applyOverride(e.setDayOverride.date, e.setDayOverride.endMin, ctx);
      else if ('openStartPopover' in e) {
        this.startTab = 'planned';
        this.startOpen = true;
      }
    }
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

  private ring(): void {
    this.ringCount++;
    const w = this.app.widget;
    if (w && !w.isDestroyed()) w.webContents.send('spyder:ring');
  }

  saveHeartbeat(): void {
    repo.saveHeartbeat(this.app.db, this.app.clock.now(), this.state);
  }

  // ---- commands from IPC / tray --------------------------------------------------
  start(input: StartInput): { ok: true } | (EngineError & { elapsedSec?: number }) {
    const err = this.dispatch({ type: 'START', ...input });
    if (err) {
      if (err.error === 'needs_label') return { ...err, elapsedSec: this.sessionInfo(err.sessionId)?.elapsedSec ?? 0 };
      return err;
    }
    this.startOpen = false;
    this.push();
    return { ok: true };
  }

  answer(promptId: string, a: Answer): { ok: true } | EngineError {
    return this.dispatch({ type: 'ANSWER', promptId, answer: a }) ?? { ok: true };
  }

  /**
   * Review: classify a pending away period. Uses its prompt when it is still queued; otherwise
   * (an earlier day, or the prompt was lost) applies the same DB effects directly.
   */
  classifyAway(awayId: string, classification: AwayClassification, label: string | null): { ok: true } | EngineError {
    const p = this.state.prompts.find((q) => q.awayId === awayId);
    if (p) return this.answer(p.id, { classification, label });
    const row = repo.awayRow(this.app.db, awayId);
    if (!row) return { error: 'invalid', message: 'Unknown away period' };
    const clean = label?.trim() || null;
    if (classification === 'offline_work' && !clean) return { error: 'invalid', message: 'Offline work needs a label' };
    const now = this.app.clock.now();
    const fx: DbEffect[] = [];
    if (classification === 'working') {
      let sessionId = row.interrupted_session_id;
      if (!sessionId) {
        sessionId = randomUUID();
        fx.push({
          db: 'insertSession',
          row: { id: sessionId, kind: 'open', name: null, projectId: null, plannedSec: null, direction: null, status: 'done', startedMs: row.start_ms, createdMs: now },
        });
        fx.push({ db: 'updateSession', row: { id: sessionId, endedMs: row.end_ms, overtimeSec: 0, endReason: 'done' } });
      }
      fx.push({ db: 'insertSegment', row: { id: randomUUID(), sessionId, startMs: row.start_ms, endMs: row.end_ms, source: 'away_working' } });
    }
    fx.push({ db: 'updateAway', row: { id: awayId, classification, label: clean, classifiedMs: now } });
    repo.applyDbEffects(this.app.db, fx);
    this.push();
    return { ok: true };
  }

  openStart(tab: Kind = 'planned'): void {
    this.startTab = tab;
    this.startOpen = true;
    this.push();
  }

  closeStart(): void {
    this.startOpen = false;
    this.push();
  }

  togglePause(): void {
    this.dispatch({ type: this.state.paused ? 'RESUME' : 'PAUSE' });
  }

  // ---- nudge (plan §8) ---------------------------------------------------------
  feedSample(sample: ActivitySample, tsMs = this.app.clock.now()): ActivityCategory {
    const category = categorize(sample, this.rules);
    const target = sample.domain ?? sample.appName ?? sample.exe;
    const r = stepNudge(this.nudge, { tsMs, category, target, inWorkSession: inWorkSession(this.state) }, this.app.settings);
    this.nudge = r.state;
    this.distracted = r.isDistracted;
    if (category === 'distracting') this.distractTarget = target;
    if (r.nudge) {
      const cur = this.state.current;
      repo.insertFlag(this.app.db, { tsMs, sessionId: cur?.id ?? null, target: r.nudge.target, continuousSec: r.nudge.continuousSec });
      this.toastCount++;
      toast(nudgeMessage(r.nudge.target, cur?.name ?? null, r.nudge.continuousSec));
    }
    this.push();
    return category;
  }

  reloadRules(): void {
    this.rules = repo.loadRules(this.app.db);
    this.productiveCache.atMs = Number.NaN;
  }

  // ---- view models -----------------------------------------------------------------
  sessionInfo(id: string): SessionInfo | null {
    const now = this.app.clock.now();
    const live = [this.state.current, this.state.paused, this.state.away?.interrupted].find((a) => a?.id === id);
    if (live) return { name: live.name, elapsedSec: elapsedSec(live, now), plannedSec: live.plannedSec };
    const row = repo.sessionRow(this.app.db, id);
    return row ? { name: row.name, elapsedSec: row.elapsed_sec, plannedSec: row.planned_sec } : null;
  }

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

  widget(): WidgetPayload {
    const ctx = this.ctx();
    const vm = widgetView(this.state, ctx, {
      productiveTodaySec: this.productiveToday(ctx.now),
      goalSec: this.app.settings.goalSec,
      isDistracted: this.distracted && inWorkSession(this.state),
    });
    const ds = this.nudge.distractStartMs;
    return {
      ...vm,
      style: this.app.settings.widgetStyle,
      distractTarget: vm.isDistracted ? this.distractTarget : null,
      distractSec: vm.isDistracted && ds !== null ? Math.floor((ctx.now - ds) / 1000) : 0,
    };
  }

  promptState(): PromptWindowState {
    if (this.startOpen) return { view: 'start', defaultDirection: this.app.settings.defaultDirection, tab: this.startTab };
    const p = visiblePrompt(this.state);
    if (!p) return null;
    return { view: 'prompt', prompt: promptView(p, this.state.prompts.length, p.sessionId ? this.sessionInfo(p.sessionId) : null) };
  }

  push(): void {
    const w = this.widget();
    const wj = JSON.stringify(w);
    if (wj !== this.lastWidget) {
      this.lastWidget = wj;
      for (const win of [this.app.widget, this.app.dashboard]) {
        if (win && !win.isDestroyed()) win.webContents.send('spyder:widget', w);
      }
      const timer = w.mode === 'away' ? 'Away' : w.mode === 'off_hours' ? '' : `${w.isOvertime ? '+' : ''}${fmtClock(w.timerSec)}`;
      setTrayTooltip(this.app, `Spyder — ${w.title} ${timer}`.trim());
    }
    const p = this.promptState();
    const pj = JSON.stringify(p);
    if (pj !== this.lastPrompt) {
      const wasNull = this.lastPrompt === '' || this.lastPrompt === 'null';
      this.lastPrompt = pj;
      const win = this.app.prompt;
      if (win && !win.isDestroyed()) win.webContents.send('spyder:prompt', p);
      if (p && wasNull) showPrompt(this.app);
      else if (!p) hidePrompt(this.app);
    }
  }

  debugState(): Record<string, unknown> {
    return {
      engine: this.state,
      ringCount: this.ringCount,
      toastCount: this.toastCount,
      startOpen: this.startOpen,
      widgetVM: this.widget(),
      promptState: this.promptState(),
      today: dateKey(this.app.clock.now()),
    };
  }
}
