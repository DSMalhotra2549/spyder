// Session engine: a pure reducer (plan §7, ADR-0004, ADR-0006). Rule ids E1–E19 refer to the plan; E20–E22
// (editing sessions after the fact, P52–P54) are defined here.
import { dateKey, inWork, minutesOfDay, workdayPct } from './schedule';
import type {
  Active,
  Answer,
  Ctx,
  Effect,
  EndReason,
  EngineError,
  EngineEvent,
  EngineState,
  Prompt,
  PromptType,
  ReduceResult,
  StartInput,
} from './types';

export const HEARTBEAT_EVERY_MS = 15_000;
export const FRESH_HEARTBEAT_MS = 60_000;
export const OPEN_CAP_SEC = 86_400;

export function initialState(): EngineState {
  return {
    mode: 'off_hours',
    current: null,
    paused: null,
    away: null,
    prompts: [],
    reviewOpenedFor: null,
    lastHeartbeatMs: null,
  };
}

export const PRIORITY: Record<PromptType, number> = {
  away: 0,
  recovery: 0,
  timeUp: 1,
  label: 1,
  breakEnd: 1,
  checkIn: 2,
};

export function elapsedSec(a: Active, now: number): number {
  return a.accumulatedSec + (a.segmentStartMs !== null ? Math.max(0, now - a.segmentStartMs) / 1000 : 0);
}

/** Mutable working copy plus effect list for one reduce call. */
class Run {
  readonly effects: Effect[] = [];
  error?: EngineError;
  readonly st: EngineState;
  readonly ctx: Ctx;
  constructor(st: EngineState, ctx: Ctx) {
    this.st = st;
    this.ctx = ctx;
  }

  get now() {
    return this.ctx.now;
  }
  emit(e: Effect) {
    this.effects.push(e);
  }
  inWorkNow() {
    return inWork(this.now, this.ctx.window(this.now));
  }

  // ---- prompts -------------------------------------------------------------
  findPrompt(type: PromptType, sessionId?: string): Prompt | undefined {
    return this.st.prompts.find((p) => p.type === type && (sessionId === undefined || p.sessionId === sessionId));
  }

  queue(p: Omit<Prompt, 'id' | 'createdMs'>): Prompt {
    const dup = this.st.prompts.find(
      (q) => q.type === p.type && q.sessionId === p.sessionId && q.awayId === p.awayId,
    );
    if (dup) return dup;
    const prompt: Prompt = { ...p, id: this.ctx.newId(), createdMs: this.now };
    const pr = PRIORITY[p.type];
    let i = this.st.prompts.length;
    while (i > 0 && PRIORITY[this.st.prompts[i - 1].type] > pr) i--;
    this.st.prompts.splice(i, 0, prompt);
    this.emit({ promptsChanged: true });
    return prompt;
  }

  removePrompts(pred: (p: Prompt) => boolean) {
    const before = this.st.prompts.length;
    this.st.prompts = this.st.prompts.filter((p) => !pred(p));
    if (this.st.prompts.length !== before) this.emit({ promptsChanged: true });
  }

  moveToFront(p: Prompt) {
    const pr = PRIORITY[p.type];
    const rest = this.st.prompts.filter((q) => q !== p);
    let i = 0;
    while (i < rest.length && PRIORITY[rest[i].type] < pr) i++;
    rest.splice(i, 0, p);
    this.st.prompts = rest;
    this.emit({ promptsChanged: true });
  }

  // ---- segments & sessions --------------------------------------------------
  openSegment(a: Active, at: number) {
    const id = this.ctx.newId();
    a.segmentId = id;
    a.segmentStartMs = at;
    this.emit({ db: 'openSegment', row: { id, sessionId: a.id, startMs: at, source: 'live' } });
  }

  /** Closes the open segment (if any) at max(at, segment start) and syncs elapsed_sec. */
  closeSegment(a: Active, at: number) {
    if (a.segmentId === null || a.segmentStartMs === null) return;
    const end = Math.max(at, a.segmentStartMs);
    this.emit({ db: 'closeSegment', row: { id: a.segmentId, endMs: end } });
    a.accumulatedSec += (end - a.segmentStartMs) / 1000;
    a.segmentId = null;
    a.segmentStartMs = null;
  }

  startSession(input: StartInput, at: number): Active {
    const kind = input.kind;
    const a: Active = {
      id: this.ctx.newId(),
      kind,
      name: input.name?.trim() || (kind === 'break' ? 'Break' : null),
      projectId: input.projectId ?? null,
      plannedSec: kind === 'open' ? null : (input.plannedSec ?? null),
      direction: kind === 'planned' ? (input.direction ?? this.ctx.settings.defaultDirection) : null,
      startedMs: at,
      accumulatedSec: 0,
      segmentId: null,
      segmentStartMs: null,
      timeUpAtMs: null,
      lastNagMs: null,
      lastCheckInMs: at,
    };
    this.emit({
      db: 'insertSession',
      row: {
        id: a.id,
        kind: a.kind,
        name: a.name,
        projectId: a.projectId,
        plannedSec: a.plannedSec,
        direction: a.direction,
        status: 'running',
        startedMs: at,
        createdMs: this.now,
      },
    });
    this.openSegment(a, at);
    this.st.current = a;
    return a;
  }

  /** E10 */
  startOpen() {
    this.startSession({ kind: 'open' }, this.now);
  }

  /** Closes a session for good; queues `label` if it's unlabelled work (P21). */
  closeSession(a: Active, at: number, reason: EndReason) {
    this.closeSegment(a, at);
    const elapsed = Math.round(a.accumulatedSec);
    const overtime = a.plannedSec !== null ? Math.max(0, elapsed - a.plannedSec) : 0;
    this.emit({
      db: 'updateSession',
      row: {
        id: a.id,
        status: 'done',
        endedMs: Math.max(at, a.startedMs),
        elapsedSec: elapsed,
        overtimeSec: overtime,
        endReason: reason,
      },
    });
    this.removePrompts(
      (p) => p.sessionId === a.id && (p.type === 'timeUp' || p.type === 'breakEnd' || p.type === 'checkIn'),
    );
    if (a.kind !== 'break' && a.name === null) this.queue({ type: 'label', sessionId: a.id });
    if (this.st.current?.id === a.id) this.st.current = null;
    if (this.st.paused?.id === a.id) this.st.paused = null;
  }

  setStatus(a: Active, status: 'running' | 'paused' | 'interrupted') {
    this.emit({ db: 'updateSession', row: { id: a.id, status, elapsedSec: Math.round(a.accumulatedSec) } });
  }

  resume(a: Active) {
    this.st.current = a;
    this.openSegment(a, this.now);
    this.setStatus(a, 'running');
  }

  openReview(date: string) {
    if (this.st.reviewOpenedFor === date) return;
    this.st.reviewOpenedFor = date;
    this.emit({ openReview: date });
  }

  heartbeat() {
    this.st.lastHeartbeatMs = this.now;
    this.emit({ saveHeartbeat: true });
  }
}

// ---------------------------------------------------------------------------

export function reduce(state: EngineState, event: EngineEvent, ctx: Ctx): ReduceResult {
  const r = new Run(structuredClone(state), ctx);
  apply(r, event);
  return r.error ? { state, effects: [], error: r.error } : { state: r.st, effects: r.effects };
}

function apply(r: Run, ev: EngineEvent): void {
  switch (ev.type) {
    case 'BOOT':
      return boot(r, ev.heartbeat);
    case 'TICK':
    case 'SCHEDULE_CHANGED': // E19
      return tick(r);
    case 'START':
      return start(r, ev);
    case 'DONE':
      return done(r);
    case 'EXTEND':
      return extend(r, ev.sec);
    case 'PAUSE':
      return pause(r);
    case 'RESUME':
      return resume(r);
    case 'LABEL':
      return label(r, ev.sessionId, ev.name, ev.projectId ?? null);
    case 'ANSWER':
      return answer(r, ev.promptId, ev.answer);
    case 'AWAY_BEGIN':
      return awayBegin(r, ev.atMs, ev.reason);
    case 'AWAY_END':
      return awayEnd(r);
    case 'KEEP_WORKING':
      return keepWorking(r);
    case 'DROP':
      return drop(r, ev.sessionId);
    case 'ABSORB':
      return absorb(r, ev.sessionId, ev.addSec, ev.removedIds);
    case 'RESTORE':
      return restore(r, ev.active, ev.replacesId);
  }
}

/** E1 */
function boot(r: Run, hb: { tsMs: number; state: EngineState } | null): void {
  if (!hb) return tick(r);
  Object.assign(r.st, structuredClone(hb.state));
  if (hb.state.mode === 'working' && r.st.current) {
    if (r.now - hb.tsMs <= FRESH_HEARTBEAT_MS) {
      const a = r.st.current;
      r.closeSegment(a, hb.tsMs);
      r.openSegment(a, r.now);
      return tick(r);
    }
    awayBegin(r, hb.tsMs, 'not_running');
    if (r.st.mode === 'away') awayEnd(r);
    return tick(r);
  }
  if (hb.state.mode === 'away' && r.st.away) return awayEnd(r);
  return tick(r);
}

/** E2–E4 */
function tick(r: Run): void {
  const st = r.st;
  if (st.mode === 'away') return; // E4
  if (st.mode === 'off_hours') {
    // E2
    if (r.inWorkNow()) {
      r.startOpen();
      st.mode = 'working';
      r.heartbeat();
    }
    return;
  }
  // E3 working
  const now = r.now;
  const win = r.ctx.window(now);
  if (!inWork(now, win)) {
    // (a) work hours are over (or today was switched off)
    const at = win && now >= win.endMs ? win.endMs : now;
    if (st.current) r.closeSession(st.current, at, 'work_hours_end');
    if (st.paused) r.closeSession(st.paused, at, 'work_hours_end');
    st.mode = 'off_hours';
    r.openReview(dateKey(now));
    r.heartbeat();
    return;
  }
  const a = st.current;
  if (!a) {
    r.startOpen();
    return;
  }
  const el = elapsedSec(a, now);
  // (b) time up
  if (a.plannedSec !== null && a.kind !== 'open' && el >= a.plannedSec && a.timeUpAtMs === null) {
    a.timeUpAtMs = a.lastNagMs = now;
    r.emit({ ring: true });
    r.queue({ type: timeUpPromptType(a), sessionId: a.id });
  } else if (a.timeUpAtMs !== null && a.lastNagMs !== null) {
    // (c) re-nag (P5)
    const p = r.findPrompt(timeUpPromptType(a), a.id);
    if (p && now - a.lastNagMs >= r.ctx.settings.nagIntervalSec * 1000) {
      r.emit({ ring: true });
      a.lastNagMs = now;
      r.moveToFront(p);
    }
  }
  if (a.kind === 'open') {
    // (d) check-in (P8)
    if (now - a.lastCheckInMs >= r.ctx.settings.checkInIntervalSec * 1000 && !r.findPrompt('checkIn')) {
      r.queue({ type: 'checkIn', sessionId: a.id });
    }
    // (e) 24 h cap
    if (el >= OPEN_CAP_SEC) {
      r.closeSession(a, now, 'cap_24h');
      r.startOpen();
    }
  }
  // (f)
  if (st.lastHeartbeatMs === null || now - st.lastHeartbeatMs >= HEARTBEAT_EVERY_MS) r.heartbeat();
}

function timeUpPromptType(a: Active): PromptType {
  return a.kind === 'planned' ? 'timeUp' : a.kind === 'timed' ? 'label' : 'breakEnd';
}

/** E8 */
function start(r: Run, input: StartInput): void {
  const st = r.st;
  if (input.kind === 'planned' && !input.name?.trim()) {
    r.error = { error: 'invalid', message: 'A planned session needs a name' };
    return;
  }
  if ((input.kind === 'planned' || input.kind === 'timed') && !(input.plannedSec && input.plannedSec > 0)) {
    r.error = { error: 'invalid', message: 'A duration is required' };
    return;
  }
  if (st.mode === 'away') {
    r.error = { error: 'invalid', message: 'Classify the away time first' };
    return;
  }
  if (st.current && st.current.kind !== 'break' && st.current.name === null) {
    r.error = { error: 'needs_label', sessionId: st.current.id };
    return;
  }
  if (st.paused && st.paused.name === null) {
    r.error = { error: 'needs_label', sessionId: st.paused.id };
    return;
  }
  if (st.current) r.closeSession(st.current, r.now, 'switched');
  if (st.paused) r.closeSession(st.paused, r.now, 'switched');
  if (st.mode === 'off_hours') {
    const extra = Math.max(r.ctx.settings.keepWorkingStepMin, Math.ceil((input.plannedSec ?? 0) / 60));
    r.emit({ setDayOverride: { date: dateKey(r.now), endMin: minutesOfDay(r.now) + extra } });
    st.mode = 'working';
  }
  r.startSession(input, r.now);
  r.heartbeat();
}

/** E9 */
function done(r: Run): void {
  const st = r.st;
  const a = st.current;
  if (!a) return;
  if (a.kind === 'break') {
    if (st.paused) return resume(r);
    r.closeSession(a, r.now, 'done');
    if (r.inWorkNow()) r.startOpen();
    else st.mode = 'off_hours';
    return;
  }
  r.closeSession(a, r.now, 'done');
  if (r.inWorkNow()) r.startOpen();
  else st.mode = 'off_hours';
}

/** E11 */
function extend(r: Run, sec: number): void {
  const a = r.st.current;
  if (!a || a.plannedSec === null || !(sec > 0)) return;
  a.plannedSec += sec;
  r.emit({ db: 'updateSession', row: { id: a.id, plannedSec: a.plannedSec } });
  if (elapsedSec(a, r.now) < a.plannedSec) {
    a.timeUpAtMs = null;
    a.lastNagMs = null;
    r.removePrompts(
      (p) => p.sessionId === a.id && (p.type === 'timeUp' || p.type === 'label' || p.type === 'breakEnd'),
    );
  }
}

/** E12 PAUSE */
function pause(r: Run): void {
  const st = r.st;
  const a = st.current;
  if (st.mode !== 'working' || !a || a.kind === 'break' || st.paused) return;
  r.closeSegment(a, r.now);
  r.setStatus(a, 'paused');
  st.paused = a;
  st.current = null;
  r.startSession({ kind: 'break', name: 'Paused' }, r.now);
}

/** E12 RESUME */
function resume(r: Run): void {
  const st = r.st;
  const p = st.paused;
  if (!p || !st.current || st.current.kind !== 'break') return;
  r.closeSession(st.current, r.now, 'resumed');
  st.paused = null;
  r.resume(p);
}

/** E17 */
function label(r: Run, sessionId: string, name: string, projectId: string | null): void {
  const clean = name.trim();
  if (!clean) {
    r.error = { error: 'invalid', message: 'A label is required' };
    return;
  }
  r.emit({ db: 'updateSession', row: { id: sessionId, name: clean, projectId } });
  for (const a of [r.st.current, r.st.paused, r.st.away?.interrupted]) {
    if (a?.id === sessionId) {
      a.name = clean;
      a.projectId = projectId;
    }
  }
  r.removePrompts((p) => p.type === 'label' && p.sessionId === sessionId);
}

/** Sessions that can't be deleted or merged right now (P53): the paused one, its pause break, the one an away period interrupted. */
function locked(st: EngineState): Set<string> {
  const ids = new Set<string>();
  if (st.paused) {
    ids.add(st.paused.id);
    if (st.current) ids.add(st.current.id);
  }
  if (st.away?.interrupted) ids.add(st.away.interrupted.id);
  return ids;
}

const LOCKED_MSG = 'Resume or finish the paused session first';

/** E20 (P53). The DB row is hidden by the host; the running session is replaced by a fresh open session. */
function drop(r: Run, id: string): void {
  const st = r.st;
  if (locked(st).has(id)) {
    r.error = { error: 'invalid', message: LOCKED_MSG };
    return;
  }
  r.removePrompts((p) => p.sessionId === id);
  const a = st.current;
  if (a?.id !== id) return;
  r.closeSegment(a, r.now);
  r.emit({
    db: 'updateSession',
    row: { id, status: 'done', endedMs: Math.max(r.now, a.startedMs), elapsedSec: Math.round(a.accumulatedSec), overtimeSec: 0, endReason: 'done' },
  });
  st.current = null;
  if (r.inWorkNow()) r.startOpen();
  else st.mode = 'off_hours';
  r.heartbeat();
}

/** E21 (P54). The host moves the segments; the engine keeps the running session's time and prompts in step. */
function absorb(r: Run, id: string, addSec: number, removedIds: string[]): void {
  const st = r.st;
  const lock = locked(st);
  if (lock.has(id) || removedIds.some((x) => lock.has(x) || x === st.current?.id)) {
    r.error = { error: 'invalid', message: st.paused ? LOCKED_MSG : 'The running session must be the one kept' };
    return;
  }
  r.removePrompts((p) => p.sessionId !== undefined && removedIds.includes(p.sessionId));
  const a = st.current;
  if (a?.id !== id) return;
  a.accumulatedSec = Math.max(0, a.accumulatedSec + addSec);
  if (a.timeUpAtMs !== null && a.plannedSec !== null && elapsedSec(a, r.now) < a.plannedSec) {
    a.timeUpAtMs = null;
    a.lastNagMs = null;
    r.removePrompts((p) => p.sessionId === a.id && (p.type === 'timeUp' || p.type === 'label' || p.type === 'breakEnd'));
  }
  r.heartbeat();
}

/** E22: Undo of E20 on the running session, while the fresh open session it started is still current and unlabelled. */
function restore(r: Run, active: Active, replacesId: string): void {
  const st = r.st;
  const cur = st.current;
  if (st.mode !== 'working' || !cur || cur.id !== replacesId || cur.name !== null || st.paused) {
    r.error = { error: 'invalid', message: 'The session has moved on' };
    return;
  }
  r.removePrompts((p) => p.sessionId === replacesId);
  st.current = { ...structuredClone(active), segmentId: cur.segmentId, segmentStartMs: cur.segmentStartMs };
  r.heartbeat();
}

/** E5 */
function awayBegin(r: Run, atMs: number, reason: 'idle' | 'suspend' | 'lock' | 'not_running'): void {
  const st = r.st;
  const a = st.current;
  if (st.mode !== 'working' || !a || a.kind === 'break') return; // P18
  r.closeSegment(a, atMs);
  r.setStatus(a, 'interrupted');
  st.away = { startMs: atMs, reason, interrupted: a };
  st.current = null;
  st.mode = 'away';
  r.heartbeat();
}

/** E6 */
function awayEnd(r: Run): void {
  const st = r.st;
  const away = st.away;
  if (st.mode !== 'away' || !away) return;
  const now = r.now;
  const startWin = r.ctx.window(away.startMs);
  // The away period ran past the end of the day it started in (P33).
  const dayEnded = !!startWin && away.startMs < startWin.endMs && startWin.endMs <= now;
  const end = dayEnded ? Math.min(now, startWin!.endMs) : now;
  const interrupted = away.interrupted;
  st.away = null;

  if ((end - away.startMs) / 1000 >= r.ctx.settings.shortAwayIgnoreSec) {
    const id = r.ctx.newId();
    r.emit({
      db: 'insertAway',
      row: { id, startMs: away.startMs, endMs: end, reason: away.reason, interruptedSessionId: interrupted?.id ?? null },
    });
    r.queue({
      type: away.reason === 'not_running' ? 'recovery' : 'away',
      awayId: id,
      sessionId: interrupted?.id,
      awayStartMs: away.startMs,
      awayEndMs: end,
    });
  }

  const nowInWork = r.inWorkNow();
  if (dayEnded || !nowInWork) {
    if (interrupted) r.closeSession(interrupted, away.startMs, 'work_hours_end');
    if (st.paused) r.closeSession(st.paused, away.startMs, 'work_hours_end');
    st.mode = 'off_hours';
    r.openReview(dateKey(away.startMs));
    if (nowInWork) {
      r.startOpen();
      st.mode = 'working';
    }
  } else {
    if (interrupted) {
      // Time away doesn't count toward the next check-in (P48).
      interrupted.lastCheckInMs += now - away.startMs;
      r.resume(interrupted);
    } else r.startOpen();
    st.mode = 'working';
  }
  r.heartbeat();
}

/** E18 */
function keepWorking(r: Run): void {
  const st = r.st;
  const win = r.ctx.window(r.now);
  const nowMin = minutesOfDay(r.now);
  const schedEnd = win ? minutesOfDay(win.endMs) || 1440 : nowMin;
  r.emit({
    setDayOverride: {
      date: dateKey(r.now),
      endMin: Math.max(schedEnd, nowMin) + r.ctx.settings.keepWorkingStepMin,
    },
  });
  if (st.mode === 'off_hours') {
    r.startOpen();
    st.mode = 'working';
    r.heartbeat();
  }
}

/** E7, E13–E16 */
function answer(r: Run, promptId: string, ans: Answer): void {
  const st = r.st;
  const p = st.prompts.find((q) => q.id === promptId);
  if (!p) {
    r.error = { error: 'unknown_prompt' };
    return;
  }
  const isCurrent = !!p.sessionId && st.current?.id === p.sessionId;
  switch (p.type) {
    case 'away':
    case 'recovery':
      return answerAway(r, p, ans);
    case 'timeUp': // E13
      if (ans === 'done' || ans === 'switch') {
        r.removePrompts((q) => q === p);
        if (isCurrent) done(r);
        if (ans === 'switch') r.emit({ openStartPopover: true });
        return;
      }
      if (typeof ans === 'object' && 'extend' in ans) {
        if (isCurrent) extend(r, ans.extend);
        return;
      }
      break;
    case 'breakEnd': // E16
      if (ans === 'back') {
        r.removePrompts((q) => q === p);
        if (isCurrent) done(r);
        return;
      }
      if (typeof ans === 'object' && 'extend' in ans) {
        if (isCurrent) extend(r, ans.extend);
        return;
      }
      break;
    case 'label': // E14
      if (typeof ans === 'object' && 'name' in ans && !('action' in ans)) {
        label(r, p.sessionId!, ans.name, ans.projectId ?? null);
        if (r.error) return;
        // A timed session is named when its time is up; naming it ends it (P3).
        const a = st.current;
        if (isCurrent && a && a.kind === 'timed' && a.timeUpAtMs !== null) done(r);
        return;
      }
      break;
    case 'checkIn': // E15
      if (typeof ans === 'object' && 'action' in ans) {
        r.removePrompts((q) => q === p);
        const a = isCurrent ? st.current : null;
        if (ans.action === 'still') {
          if (a) a.lastCheckInMs = r.now;
          return;
        }
        if (!a) return;
        label(r, a.id, ans.name, ans.projectId ?? null);
        if (r.error) return;
        if (ans.action === 'continue') {
          a.lastCheckInMs = r.now;
        } else {
          r.closeSession(a, r.now, 'checkin_fresh');
          r.startOpen();
        }
        return;
      }
      break;
  }
  r.error = { error: 'invalid', message: `Unexpected answer for ${p.type}` };
}

/** E7 */
function answerAway(r: Run, p: Prompt, ans: Answer): void {
  if (typeof ans !== 'object' || !('classification' in ans)) {
    r.error = { error: 'invalid', message: 'Pick a classification' };
    return;
  }
  const label = ans.label?.trim() || null;
  if (ans.classification === 'offline_work' && !label) {
    r.error = { error: 'invalid', message: 'Offline work needs a label' };
    return;
  }
  const startMs = p.awayStartMs!;
  const endMs = p.awayEndMs!;
  if (ans.classification === 'working') {
    const live = [r.st.current, r.st.paused].find((a) => a && a.id === p.sessionId) ?? null;
    if (p.sessionId) {
      r.emit({
        db: 'insertSegment',
        row: { id: r.ctx.newId(), sessionId: p.sessionId, startMs, endMs, source: 'away_working' },
      });
      if (live) {
        live.accumulatedSec += (endMs - startMs) / 1000;
        r.emit({ db: 'updateSession', row: { id: live.id, elapsedSec: Math.round(live.accumulatedSec) } });
      }
    } else {
      const id = r.ctx.newId();
      const sec = Math.round((endMs - startMs) / 1000);
      r.emit({
        db: 'insertSession',
        row: {
          id,
          kind: 'open',
          name: null,
          projectId: null,
          plannedSec: null,
          direction: null,
          status: 'done',
          startedMs: startMs,
          createdMs: r.now,
        },
      });
      r.emit({ db: 'insertSegment', row: { id: r.ctx.newId(), sessionId: id, startMs, endMs, source: 'away_working' } });
      r.emit({ db: 'updateSession', row: { id, endedMs: endMs, elapsedSec: sec, overtimeSec: 0, endReason: 'done' } });
      r.queue({ type: 'label', sessionId: id });
    }
  }
  r.emit({
    db: 'updateAway',
    row: { id: p.awayId!, classification: ans.classification, label, classifiedMs: r.now },
  });
  r.removePrompts((q) => q === p);
}

// ---------------------------------------------------------------------------
// Widget view model (plan §7)

export interface WidgetExtras {
  productiveTodaySec: number;
  goalSec: number;
  isDistracted: boolean;
}

export interface WidgetVM {
  mode: EngineState['mode'];
  kind: Active['kind'] | null;
  title: string;
  /** The running session's name while working (P46); null when unlabelled, away or off hours. */
  label: string | null;
  isUnlabelled: boolean;
  timerSec: number;
  elapsedSec: number;
  plannedSec: number | null;
  direction: 'up' | 'down' | null;
  /** 0–1 share of the planned duration used (null when there's no duration). */
  progress: number | null;
  isOvertime: boolean;
  overtimeSec: number;
  workdayPct: number;
  isDayOff: boolean;
  productiveTodaySec: number;
  goalSec: number;
  isDistracted: boolean;
  hasPrompt: boolean;
  promptCount: number;
  isPaused: boolean;
  pausedName: string | null;
  sessionId: string | null;
}

export function widgetView(state: EngineState, ctx: Pick<Ctx, 'now' | 'window'>, extras: WidgetExtras): WidgetVM {
  const now = ctx.now;
  const win = ctx.window(now);
  const a = state.mode === 'away' ? (state.away?.interrupted ?? null) : state.current;
  const el = a ? elapsedSec(a, now) : 0;
  const planned = a?.plannedSec ?? null;
  const countsDown =
    !!a && planned !== null && (a.kind === 'timed' || a.kind === 'break' || (a.kind === 'planned' && a.direction === 'down'));
  const overtime = planned !== null ? Math.max(0, el - planned) : 0;
  const isOvertime = planned !== null && a?.kind !== 'open' && el > planned;
  const title =
    state.mode === 'off_hours' ? 'Off hours' : a ? (a.name ?? 'Untitled session') : 'Untitled session';
  return {
    mode: state.mode,
    kind: a?.kind ?? null,
    title,
    // While paused the running block is the pause; the label stays the paused session's.
    label: state.mode !== 'working' ? null : state.paused ? state.paused.name : (a?.name ?? null),
    isUnlabelled: state.mode !== 'off_hours' && !!a && a.kind !== 'break' && a.name === null,
    timerSec: Math.floor(countsDown ? (isOvertime ? overtime : Math.max(planned! - el, 0)) : el),
    elapsedSec: Math.floor(el),
    plannedSec: planned,
    direction: a?.direction ?? null,
    progress: planned ? Math.min(1, el / planned) : null,
    isOvertime,
    overtimeSec: Math.floor(overtime),
    workdayPct: workdayPct(now, win),
    isDayOff: !win,
    productiveTodaySec: extras.productiveTodaySec,
    goalSec: extras.goalSec,
    isDistracted: extras.isDistracted,
    hasPrompt: state.prompts.length > 0,
    promptCount: state.prompts.length,
    isPaused: !!state.paused,
    pausedName: state.paused ? (state.paused.name ?? 'Untitled session') : null,
    sessionId: a?.id ?? null,
  };
}

/** Prompt that should be visible (P22). */
export function visiblePrompt(state: EngineState): Prompt | null {
  return state.prompts[0] ?? null;
}

/** True while the user is in a non-break session (nudge input, §8). */
export function inWorkSession(state: EngineState): boolean {
  return state.mode === 'working' && !!state.current && state.current.kind !== 'break';
}
