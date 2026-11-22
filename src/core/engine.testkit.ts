// Test harness for the block engine: plays the role of the main-process host (applies day overrides).
import { DEFAULT_SCHEDULE, DEFAULT_SETTINGS } from './settings';
import { dateKey, mergeOverride, minutesOfDay, workWindow, type DayOverride } from './schedule';
import { initialState, reduce, widgetView } from './blockEngine';
import type { Ctx, Effect, EngineEvent, EngineState, ReduceResult, WorkWindow } from './types';

type DbEffect = Extract<Effect, { db: string }>;
type RowOf = { [E in Extract<DbEffect, { row: unknown }> as E['db']]: E['row'] };
type DbOp = keyof RowOf;

/** 2026-11-24 is a Tuesday (work day 10:00–17:00). */
export const T = (h: number, m = 0, s = 0, day = 24) => new Date(2026, 10, day, h, m, s).getTime();

export class Sim {
  state: EngineState = initialState();
  now = T(11);
  overrides = new Map<string, DayOverride>();
  settings = { ...DEFAULT_SETTINGS };
  log: Effect[] = [];
  last: ReduceResult | null = null;
  windowFn: ((ms: number) => WorkWindow | null) | null = null;
  private n = 0;

  ctx(): Ctx {
    return {
      now: this.now,
      window: (ms) => (this.windowFn ? this.windowFn(ms) : workWindow(ms, DEFAULT_SCHEDULE, this.overrides)),
      settings: this.settings,
      newId: () => `id${++this.n}`,
    };
  }

  send(ev: EngineEvent, at?: number): ReduceResult {
    if (at !== undefined) this.now = at;
    const r = reduce(this.state, ev, this.ctx());
    this.state = r.state;
    this.last = r;
    this.log.push(...r.effects);
    for (const e of r.effects) {
      if ('setDayOverride' in e) {
        const w = this.ctx().window(this.now);
        const cur = w ? { startMin: minutesOfDay(w.startMs), endMin: minutesOfDay(w.endMs) } : null;
        this.overrides.set(e.setDayOverride.date, {
          date: e.setDayOverride.date,
          ...mergeOverride(cur, minutesOfDay(this.now), e.setDayOverride.endMin),
        });
      }
    }
    return r;
  }

  tick(at: number) {
    return this.send({ type: 'TICK' }, at);
  }

  /** Effects from the last reduce. */
  get fx(): Effect[] {
    return this.last?.effects ?? [];
  }

  /** Blocks that ended in the last reduce (or in `effects`). */
  ended(effects = this.fx): string[] {
    return effects.flatMap((e) => ('blockEnded' in e ? [e.blockEnded] : []));
  }

  db<K extends DbOp>(op: K, effects = this.fx): RowOf[K][] {
    return effects.filter((e) => 'db' in e && e.db === op).map((e) => (e as DbEffect & { row: RowOf[K] }).row);
  }

  view(extras = { productiveTodaySec: 0, goalSec: 18000, isDistracted: false, pendingCount: 0 }) {
    return widgetView(this.state, this.ctx(), extras);
  }

  today() {
    return dateKey(this.now);
  }
}
