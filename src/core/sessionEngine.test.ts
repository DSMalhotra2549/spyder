import { describe, expect, it } from 'vitest';
import { Sim, T } from './engine.testkit';
import { initialState, inWorkSession, reduce, visiblePrompt } from './sessionEngine';
import type { AwayClassification, EngineState } from './types';

const MIN = 60;

function bootOpen(at = T(11)) {
  const s = new Sim();
  s.send({ type: 'BOOT', heartbeat: null }, at);
  return s;
}

describe('session engine — plan §13 Phase 2 scenarios', () => {
  it('1. planned 30-min countdown: ring, re-nag, overtime, extend, overtime_sec on done', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'Warm-up' });
    s.send({ type: 'START', kind: 'planned', name: 'Replying to emails', plannedSec: 30 * MIN, direction: 'down' });
    const id = s.state.current!.id;
    expect(s.view().timerSec).toBe(30 * MIN);

    s.tick(T(11, 29, 59));
    expect(s.rings()).toBe(0);
    expect(s.view().timerSec).toBe(1);
    s.tick(T(11, 30));
    expect(s.rings()).toBe(1);
    expect(visiblePrompt(s.state)).toMatchObject({ type: 'timeUp', sessionId: id });

    s.tick(T(11, 31));
    const v = s.view();
    expect(v.isOvertime).toBe(true);
    expect(v.overtimeSec).toBe(60);
    expect(v.timerSec).toBe(60);

    s.tick(T(11, 34, 59));
    expect(s.rings()).toBe(0);
    s.tick(T(11, 35));
    expect(s.rings()).toBe(1); // re-nag +5
    s.tick(T(11, 40));
    expect(s.rings()).toBe(1); // re-nag +10

    const p = visiblePrompt(s.state)!;
    s.send({ type: 'ANSWER', promptId: p.id, answer: { extend: 15 * MIN } }, T(11, 41));
    expect(s.state.prompts).toHaveLength(0);
    expect(s.state.current!.timeUpAtMs).toBeNull();
    expect(s.view().isOvertime).toBe(false);
    expect(s.view().timerSec).toBe(4 * MIN);

    s.send({ type: 'DONE' }, T(11, 50));
    const upd = s.db('updateSession').find((r) => r.id === id)!;
    expect(upd).toMatchObject({ status: 'done', endReason: 'done', elapsedSec: 50 * MIN, overtimeSec: 5 * MIN });
    expect(s.state.current!.kind).toBe('open');
  });

  it('2. planned count-up shows elapsed and still rings at the planned time', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'planned', name: 'Deep work', plannedSec: 20 * MIN, direction: 'up' });
    s.tick(T(11, 5));
    expect(s.view().timerSec).toBe(5 * MIN);
    expect(s.view().direction).toBe('up');
    s.tick(T(11, 20));
    expect(s.rings()).toBe(1);
    expect(visiblePrompt(s.state)!.type).toBe('timeUp');
    s.tick(T(11, 22));
    expect(s.view().timerSec).toBe(22 * MIN);
  });

  it('3. timed 10 min → label prompt → labelled, then an open session follows', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'timed', plannedSec: 10 * MIN });
    const id = s.state.current!.id;
    expect(s.state.current!.name).toBeNull();
    expect(s.view().timerSec).toBe(10 * MIN);
    s.tick(T(11, 10));
    expect(s.rings()).toBe(1);
    const p = visiblePrompt(s.state)!;
    expect(p).toMatchObject({ type: 'label', sessionId: id });
    s.send({ type: 'ANSWER', promptId: p.id, answer: { name: 'Inbox zero', projectId: null } }, T(11, 11));
    expect(s.db('updateSession').find((r) => r.id === id && r.name)).toMatchObject({ name: 'Inbox zero' });
    expect(s.db('updateSession').find((r) => r.id === id && r.status)).toMatchObject({ status: 'done' });
    expect(s.state.current!.kind).toBe('open');
    expect(s.state.current!.id).not.toBe(id);
    expect(s.state.prompts).toHaveLength(0);
  });

  it('4. open session check-ins: continue keeps id, fresh starts new, still resets timer', () => {
    const s = bootOpen();
    const id1 = s.state.current!.id;
    s.tick(T(11, 29, 59));
    expect(s.state.prompts).toHaveLength(0);
    s.tick(T(11, 30));
    let p = visiblePrompt(s.state)!;
    expect(p).toMatchObject({ type: 'checkIn', sessionId: id1 });
    s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'continue', name: 'Planning' } });
    expect(s.state.current!.id).toBe(id1);
    expect(s.state.current!.name).toBe('Planning');
    expect(s.view().title).toBe('Planning');

    s.tick(T(12, 0));
    p = visiblePrompt(s.state)!;
    expect(p.type).toBe('checkIn');
    s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'fresh', name: 'Planning' } });
    expect(s.db('updateSession').find((r) => r.id === id1 && r.endReason)).toMatchObject({ endReason: 'checkin_fresh' });
    const id2 = s.state.current!.id;
    expect(id2).not.toBe(id1);
    expect(s.state.current!.name).toBeNull();

    s.tick(T(12, 30));
    p = visiblePrompt(s.state)!;
    s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'still' } });
    expect(s.state.current!.id).toBe(id2);
    expect(s.state.prompts).toHaveLength(0);
    s.tick(T(12, 59));
    expect(s.state.prompts).toHaveLength(0);
    s.tick(T(13, 0));
    expect(visiblePrompt(s.state)!.type).toBe('checkIn');
  });

  it('5. DONE on an unlabelled open session queues label and starts a new open session', () => {
    const s = bootOpen();
    const id = s.state.current!.id;
    s.send({ type: 'DONE' }, T(11, 45));
    expect(s.state.prompts).toEqual([expect.objectContaining({ type: 'label', sessionId: id })]);
    expect(s.state.current!.kind).toBe('open');
    expect(s.state.current!.id).not.toBe(id);
  });

  it('6. START while unlabelled → needs_label; after LABEL it succeeds and the old one is switched', () => {
    const s = bootOpen();
    const id = s.state.current!.id;
    const before = s.state;
    const r = s.send({ type: 'START', kind: 'planned', name: 'Write spec', plannedSec: 25 * MIN }, T(11, 45));
    expect(r.error).toEqual({ error: 'needs_label', sessionId: id });
    expect(r.effects).toEqual([]);
    expect(s.state).toBe(before);
    s.send({ type: 'LABEL', sessionId: id, name: 'Email triage', projectId: 'p1' });
    const r2 = s.send({ type: 'START', kind: 'planned', name: 'Write spec', plannedSec: 25 * MIN });
    expect(r2.error).toBeUndefined();
    expect(s.db('updateSession').find((x) => x.id === id)).toMatchObject({ endReason: 'switched', elapsedSec: 45 * MIN });
    expect(s.state.current).toMatchObject({ kind: 'planned', name: 'Write spec', direction: 'down' });
  });

  it('7. PAUSE runs a break; RESUME continues the same session with the same remaining time', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'planned', name: 'Report', plannedSec: 30 * MIN });
    const id = s.state.current!.id;
    s.tick(T(11, 10));
    const remainingBefore = s.view().timerSec;
    s.send({ type: 'PAUSE' });
    expect(s.state.current).toMatchObject({ kind: 'break', name: 'Paused' });
    expect(s.state.paused!.id).toBe(id);
    expect(s.view().isPaused).toBe(true);
    expect(s.view().pausedName).toBe('Report');
    expect(inWorkSession(s.state)).toBe(false);
    s.send({ type: 'PAUSE' }); // no-op while paused
    expect(s.state.paused!.id).toBe(id);
    s.tick(T(11, 25));
    s.send({ type: 'RESUME' });
    expect(s.state.current!.id).toBe(id);
    expect(s.state.paused).toBeNull();
    expect(s.view().timerSec).toBe(remainingBefore);
    expect(s.db('updateSession').find((r) => r.endReason)).toMatchObject({ endReason: 'resumed' });
  });

  it('8. TICK at 10:00 auto-starts an open session; BOOT at 11:00 without heartbeat starts one', () => {
    const s = new Sim();
    s.tick(T(9, 59, 59));
    expect(s.state.mode).toBe('off_hours');
    expect(s.view().title).toBe('Off hours');
    s.tick(T(10, 0));
    expect(s.state.mode).toBe('working');
    expect(s.state.current!.kind).toBe('open');
    expect(s.view().title).toBe('Untitled session');
    expect(s.view().isUnlabelled).toBe(true);

    const b = bootOpen(T(11));
    expect(b.state.current!.kind).toBe('open');
    expect(b.db('insertSession')).toHaveLength(1);
  });

  const classifications: AwayClassification[] = ['break', 'meeting', 'offline_work', 'not_working', 'working'];
  it.each(classifications)('9. idle 11:20–12:32 → 72-min away, classified %s', (c) => {
    const s = bootOpen();
    const id = s.state.current!.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 20), reason: 'idle' }, T(11, 25));
    expect(s.db('closeSegment')[0].endMs).toBe(T(11, 20));
    expect(s.state.mode).toBe('away');
    expect(s.view().title).toBe('Untitled session');
    s.send({ type: 'AWAY_END' }, T(12, 32));
    const away = s.db('insertAway')[0];
    expect(away).toMatchObject({ startMs: T(11, 20), endMs: T(12, 32), reason: 'idle', interruptedSessionId: id });
    expect((away.endMs - away.startMs) / 60000).toBe(72);
    expect(s.db('openSegment')[0]).toMatchObject({ sessionId: id, startMs: T(12, 32) });
    expect(s.state.current!.id).toBe(id);
    const p = visiblePrompt(s.state)!;
    expect(p.type).toBe('away');

    const accBefore = s.state.current!.accumulatedSec;
    const label = c === 'offline_work' ? 'Whiteboard session' : undefined;
    const r = s.send({ type: 'ANSWER', promptId: p.id, answer: { classification: c, label } }, T(12, 33));
    expect(r.error).toBeUndefined();
    expect(s.db('updateAway')[0]).toMatchObject({ id: away.id, classification: c, label: label ?? null });
    expect(s.state.prompts.filter((q) => q.type === 'away')).toHaveLength(0);
    if (c === 'working') {
      expect(s.db('insertSegment')[0]).toMatchObject({
        sessionId: id,
        startMs: T(11, 20),
        endMs: T(12, 32),
        source: 'away_working',
      });
      expect(s.state.current!.accumulatedSec - accBefore).toBe(72 * MIN);
    } else {
      expect(s.db('insertSegment')).toHaveLength(0);
    }
  });

  it('9b. offline work without a label is rejected', () => {
    const s = bootOpen();
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 20), reason: 'idle' });
    s.send({ type: 'AWAY_END' }, T(12));
    const p = visiblePrompt(s.state)!;
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: { classification: 'offline_work' } }).error).toMatchObject({
      error: 'invalid',
    });
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: 'done' }).error).toMatchObject({ error: 'invalid' });
  });

  it('10. a 30 s lock records no away period', () => {
    const s = bootOpen();
    const id = s.state.current!.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 10), reason: 'lock' }, T(11, 10));
    s.send({ type: 'AWAY_END' }, T(11, 10, 30));
    expect(s.db('insertAway')).toHaveLength(0);
    expect(s.state.prompts).toHaveLength(0);
    expect(s.state.current!.id).toBe(id);
    expect(s.state.mode).toBe('working');
  });

  it('11. AWAY_BEGIN during a break is ignored (P18)', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'break', plannedSec: 15 * MIN });
    const before = s.state;
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 2), reason: 'idle' }, T(11, 7));
    expect(s.fx).toEqual([]);
    expect(s.state).toEqual(before);
    s.send({ type: 'AWAY_END' }, T(11, 8));
    expect(s.state.mode).toBe('working');
  });

  it('12. suspend 16:30–18:00 → away [16:30,17:00], session closed at 16:30, off hours, review', () => {
    const s = bootOpen(T(16));
    const id = s.state.current!.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 30), reason: 'suspend' }, T(16, 30));
    s.send({ type: 'AWAY_END' }, T(18));
    expect(s.db('insertAway')[0]).toMatchObject({ startMs: T(16, 30), endMs: T(17), reason: 'suspend' });
    expect(s.db('updateSession').find((r) => r.id === id && r.status === 'done')).toMatchObject({
      endedMs: T(16, 30),
      endReason: 'work_hours_end',
    });
    expect(s.state.mode).toBe('off_hours');
    expect(s.fx).toContainEqual({ openReview: '2026-11-24' });
    expect(s.state.current).toBeNull();
  });

  it('13. TICK at 17:00 cuts the session and opens the review once; KEEP_WORKING extends to 17:30', () => {
    const s = bootOpen(T(16));
    const id = s.state.current!.id;
    s.tick(T(17, 0, 0));
    expect(s.db('updateSession').find((r) => r.id === id)).toMatchObject({
      endedMs: T(17),
      endReason: 'work_hours_end',
    });
    expect(s.fx).toContainEqual({ openReview: '2026-11-24' });
    expect(s.state.mode).toBe('off_hours');
    s.tick(T(17, 0, 1));
    expect(s.fx.filter((e) => 'openReview' in e)).toHaveLength(0);
    expect(s.view().workdayPct).toBe(100);

    s.send({ type: 'KEEP_WORKING' }, T(17, 0, 30));
    expect(s.fx).toContainEqual({ setDayOverride: { date: '2026-11-24', endMin: 17 * 60 + 30 } });
    expect(s.state.mode).toBe('working');
    expect(s.state.current!.kind).toBe('open');
    s.tick(T(17, 20));
    expect(s.state.mode).toBe('working');
    s.tick(T(17, 30));
    expect(s.state.mode).toBe('off_hours');
    expect(s.fx.filter((e) => 'openReview' in e)).toHaveLength(0); // already opened today
  });

  it('14. BOOT: stale heartbeat → recovery prompt; fresh heartbeat → seamless resume', () => {
    const s = bootOpen();
    s.tick(T(11, 0, 15));
    const hbState: EngineState = s.state;
    const id = hbState.current!.id;

    const stale = new Sim();
    stale.send({ type: 'BOOT', heartbeat: { tsMs: T(11, 0, 15), state: hbState } }, T(11, 40, 15));
    const p = visiblePrompt(stale.state)!;
    expect(p).toMatchObject({ type: 'recovery', awayStartMs: T(11, 0, 15), awayEndMs: T(11, 40, 15) });
    expect(stale.db('insertAway')[0]).toMatchObject({ reason: 'not_running', interruptedSessionId: id });
    expect(stale.state.current!.id).toBe(id);

    const fresh = new Sim();
    fresh.send({ type: 'BOOT', heartbeat: { tsMs: T(11, 0, 15), state: hbState } }, T(11, 0, 45));
    expect(fresh.state.prompts).toHaveLength(0);
    expect(fresh.db('closeSegment')[0]).toMatchObject({ endMs: T(11, 0, 15) });
    expect(fresh.db('openSegment')[0]).toMatchObject({ sessionId: id, startMs: T(11, 0, 45) });
    expect(fresh.state.current!.id).toBe(id);
  });

  it('15. prompt queue: away jumps ahead of a check-in; duplicate check-ins are not queued', () => {
    const s = bootOpen();
    s.tick(T(11, 30));
    expect(s.state.prompts.map((p) => p.type)).toEqual(['checkIn']);
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 31), reason: 'idle' });
    s.send({ type: 'AWAY_END' }, T(11, 40));
    s.tick(T(11, 41));
    s.tick(T(11, 50));
    expect(s.state.prompts.map((p) => p.type)).toEqual(['away', 'checkIn']);
    expect(visiblePrompt(s.state)!.type).toBe('away');
    expect(s.view().promptCount).toBe(2);
  });

  it('16. an open session is capped at 24 h', () => {
    const s = new Sim();
    s.windowFn = () => ({ startMs: 0, endMs: Number.MAX_SAFE_INTEGER });
    s.settings.checkInIntervalSec = 10 * 86400;
    s.send({ type: 'BOOT', heartbeat: null }, T(11));
    const id = s.state.current!.id;
    s.tick(T(10, 59, 59, 25));
    expect(s.state.current!.id).toBe(id);
    s.tick(T(11, 0, 0, 25));
    expect(s.db('updateSession').find((r) => r.id === id)).toMatchObject({ endReason: 'cap_24h', elapsedSec: 86400 });
    expect(s.state.prompts).toEqual([expect.objectContaining({ type: 'label', sessionId: id })]);
    expect(s.state.current!.id).not.toBe(id);
  });
});

describe('session engine — other rules', () => {
  it('heartbeat every 15 s while working', () => {
    const s = bootOpen();
    expect(s.fx).toContainEqual({ saveHeartbeat: true });
    s.tick(T(11, 0, 10));
    expect(s.fx).not.toContainEqual({ saveHeartbeat: true });
    s.tick(T(11, 0, 15));
    expect(s.fx).toContainEqual({ saveHeartbeat: true });
  });

  it('START in off hours sets a day override and works', () => {
    const s = new Sim();
    s.tick(T(18));
    s.send({ type: 'START', kind: 'planned', name: 'Late fix', plannedSec: 45 * MIN });
    expect(s.fx).toContainEqual({ setDayOverride: { date: '2026-11-24', endMin: 18 * 60 + 45 } });
    expect(s.state.mode).toBe('working');
    s.tick(T(18, 30));
    expect(s.state.mode).toBe('working');
  });

  it('START before the day starts pulls the start back without shrinking the end (P32)', () => {
    const s = new Sim();
    s.tick(T(8));
    s.send({ type: 'START', kind: 'open' });
    expect(s.overrides.get('2026-11-24')).toMatchObject({ startMin: 8 * 60, endMin: 17 * 60 });
    s.tick(T(9));
    expect(s.state.mode).toBe('working');
  });

  it('START on a day off works via override', () => {
    const s = new Sim();
    s.tick(T(11, 0, 0, 28)); // Saturday
    expect(s.view().isDayOff).toBe(true);
    expect(s.view().workdayPct).toBe(0);
    s.send({ type: 'START', kind: 'break' });
    expect(s.state.current).toMatchObject({ kind: 'break', name: 'Break' });
    expect(s.overrides.get('2026-11-28')).toMatchObject({ startMin: 11 * 60, endMin: 11 * 60 + 30 });
  });

  it('START validation', () => {
    const s = bootOpen();
    expect(s.send({ type: 'START', kind: 'planned', name: '', plannedSec: 60 }).error).toMatchObject({ error: 'invalid' });
    expect(s.send({ type: 'START', kind: 'timed', plannedSec: 0 }).error).toMatchObject({ error: 'invalid' });
    s.send({ type: 'AWAY_BEGIN', atMs: T(11), reason: 'idle' });
    expect(s.send({ type: 'START', kind: 'open' }).error).toMatchObject({ error: 'invalid' });
  });

  it('START while paused on an unlabelled session needs a label for the paused one', () => {
    const s = bootOpen();
    const id = s.state.current!.id;
    s.send({ type: 'PAUSE' });
    expect(s.send({ type: 'START', kind: 'open' }).error).toEqual({ error: 'needs_label', sessionId: id });
    s.send({ type: 'LABEL', sessionId: id, name: 'Reading' });
    s.send({ type: 'START', kind: 'open' });
    expect(s.state.paused).toBeNull();
    expect(s.db('updateSession').filter((r) => r.endReason === 'switched')).toHaveLength(2);
  });

  it('break with a duration → breakEnd; +5 extends; back ends it', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'break', plannedSec: 10 * MIN });
    expect(s.view().timerSec).toBe(10 * MIN);
    s.tick(T(11, 10));
    let p = visiblePrompt(s.state)!;
    expect(p.type).toBe('breakEnd');
    s.send({ type: 'ANSWER', promptId: p.id, answer: { extend: 300 } });
    expect(s.state.prompts).toHaveLength(0);
    s.tick(T(11, 15));
    p = visiblePrompt(s.state)!;
    s.send({ type: 'ANSWER', promptId: p.id, answer: 'back' });
    expect(s.state.current!.kind).toBe('open');
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: 'back' }).error).toEqual({ error: 'unknown_prompt' });
  });

  it('timeUp → switch ends the session and opens the start popover', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'planned', name: 'A', plannedSec: 5 * MIN });
    s.tick(T(11, 5));
    const p = visiblePrompt(s.state)!;
    s.send({ type: 'ANSWER', promptId: p.id, answer: 'switch' });
    expect(s.fx).toContainEqual({ openStartPopover: true });
    expect(s.state.current!.kind).toBe('open');
    expect(s.state.prompts).toHaveLength(0);
  });

  it('timeUp → done; wrong answers are rejected', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'planned', name: 'A', plannedSec: 5 * MIN });
    s.tick(T(11, 5));
    const p = visiblePrompt(s.state)!;
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: 'back' }).error).toMatchObject({ error: 'invalid' });
    s.send({ type: 'ANSWER', promptId: p.id, answer: 'done' });
    expect(s.state.current!.kind).toBe('open');
  });

  it('DONE on a break with a paused session resumes it; DONE on a plain break starts open', () => {
    const s = bootOpen();
    const id = s.state.current!.id;
    s.send({ type: 'PAUSE' });
    s.send({ type: 'DONE' });
    expect(s.state.current!.id).toBe(id);
    s.send({ type: 'LABEL', sessionId: id, name: 'x' });
    s.send({ type: 'START', kind: 'break' });
    s.send({ type: 'DONE' });
    expect(s.state.current!.kind).toBe('open');
    expect(s.state.prompts).toHaveLength(0);
  });

  it('DONE or break-done after work hours goes off hours', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'break' });
    s.windowFn = () => null;
    s.send({ type: 'DONE' });
    expect(s.state.mode).toBe('off_hours');
    const s2 = bootOpen();
    s2.windowFn = () => null;
    s2.send({ type: 'DONE' });
    expect(s2.state.mode).toBe('off_hours');
    expect(s2.send({ type: 'DONE' }).effects).toEqual([]);
  });

  it('EXTEND on an open session or with a bad value does nothing', () => {
    const s = bootOpen();
    expect(s.send({ type: 'EXTEND', sec: 300 }).effects).toEqual([]);
    expect(s.send({ type: 'RESUME' }).effects).toEqual([]);
  });

  it('EXTEND that does not cover the overtime keeps the prompt', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'x' });
    s.send({ type: 'START', kind: 'planned', name: 'A', plannedSec: 5 * MIN });
    s.tick(T(11, 5));
    s.tick(T(11, 20));
    s.send({ type: 'EXTEND', sec: 300 });
    expect(s.state.prompts).toHaveLength(1);
  });

  it('re-nag moves the time-up prompt ahead of other same-priority prompts', () => {
    const s = bootOpen();
    const first = s.state.current!.id;
    s.send({ type: 'DONE' }, T(11, 10)); // label prompt for `first`
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'y' });
    s.send({ type: 'START', kind: 'planned', name: 'A', plannedSec: 5 * MIN });
    s.tick(T(11, 15));
    expect(s.state.prompts.map((p) => p.type)).toEqual(['label', 'timeUp']);
    s.tick(T(11, 20));
    expect(s.state.prompts.map((p) => p.type)).toEqual(['timeUp', 'label']);
    expect(s.state.prompts[1].sessionId).toBe(first);
  });

  it('label answers: empty label rejected; labelling a non-current session only labels it', () => {
    const s = bootOpen();
    s.send({ type: 'DONE' }, T(11, 10));
    const p = visiblePrompt(s.state)!;
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: { name: '  ' } }).error).toMatchObject({ error: 'invalid' });
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'still' } }).error).toMatchObject({
      error: 'invalid',
    });
    const cur = s.state.current!.id;
    s.send({ type: 'ANSWER', promptId: p.id, answer: { name: 'Email' } });
    expect(s.state.current!.id).toBe(cur);
    expect(s.state.prompts).toHaveLength(0);
  });

  it('check-in answers for a session that is no longer current', () => {
    const s = bootOpen();
    s.tick(T(11, 30));
    const p = visiblePrompt(s.state)!;
    s.send({ type: 'PAUSE' });
    s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'continue', name: 'Z' } });
    expect(s.state.prompts).toHaveLength(0);
    s.send({ type: 'DONE' });
    s.tick(T(12, 30));
    const p2 = visiblePrompt(s.state)!;
    s.send({ type: 'PAUSE' });
    s.send({ type: 'ANSWER', promptId: p2.id, answer: { action: 'still' } });
    expect(s.state.prompts).toHaveLength(0);
    expect(s.send({ type: 'ANSWER', promptId: 'nope', answer: 'done' }).error).toEqual({ error: 'unknown_prompt' });
    expect(s.send({ type: 'LABEL', sessionId: 'x', name: '' }).error).toMatchObject({ error: 'invalid' });
  });

  it('check-in with an empty label is rejected', () => {
    const s = bootOpen();
    s.tick(T(11, 30));
    const p = visiblePrompt(s.state)!;
    expect(s.send({ type: 'ANSWER', promptId: p.id, answer: { action: 'fresh', name: '' } }).error).toMatchObject({
      error: 'invalid',
    });
  });

  it('"I was working" with no interrupted session creates a done open session and asks for a label', () => {
    const s = new Sim();
    s.state = {
      ...initialState(),
      prompts: [{ id: 'p', type: 'away', awayId: 'a1', awayStartMs: T(9), awayEndMs: T(9, 30), createdMs: T(9, 30) }],
    };
    s.send({ type: 'ANSWER', promptId: 'p', answer: { classification: 'working' } }, T(9, 31));
    const sess = s.db('insertSession')[0];
    expect(sess).toMatchObject({ kind: 'open', status: 'done', startedMs: T(9) });
    expect(s.db('insertSegment')[0]).toMatchObject({ sessionId: sess.id, startMs: T(9), endMs: T(9, 30) });
    expect(s.state.prompts).toEqual([expect.objectContaining({ type: 'label', sessionId: sess.id })]);
  });

  it('"I was working" for a session that has already ended only inserts the segment', () => {
    const s = bootOpen(T(16));
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 30), reason: 'suspend' });
    s.send({ type: 'AWAY_END' }, T(18));
    const p = s.state.prompts.find((q) => q.type === 'away')!;
    s.send({ type: 'ANSWER', promptId: p.id, answer: { classification: 'working' } });
    expect(s.db('insertSegment')).toHaveLength(1);
    expect(s.db('updateSession')).toHaveLength(0);
  });

  it('away overnight closes the old session, opens yesterday’s review and starts fresh in work hours (P33)', () => {
    const s = bootOpen(T(16));
    const id = s.state.current!.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 30), reason: 'suspend' });
    s.send({ type: 'AWAY_END' }, T(11, 0, 0, 25));
    expect(s.db('insertAway')[0]).toMatchObject({ startMs: T(16, 30), endMs: T(17) });
    expect(s.fx).toContainEqual({ openReview: '2026-11-24' });
    expect(s.state.mode).toBe('working');
    expect(s.state.current!.id).not.toBe(id);
  });

  it('away that ends outside work hours (but not past the day end) closes the session', () => {
    const s = bootOpen();
    s.send({ type: 'AWAY_BEGIN', atMs: T(11), reason: 'idle' });
    s.windowFn = () => null; // e.g. today was switched off meanwhile
    s.send({ type: 'AWAY_END' }, T(12));
    expect(s.state.mode).toBe('off_hours');
  });

  it('short away after the day ended still resumes, then the next tick closes the day', () => {
    const s = bootOpen(T(16, 59));
    const id = s.state.current!.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 59, 40), reason: 'lock' });
    s.send({ type: 'AWAY_END' }, T(17, 0, 10));
    expect(s.db('insertAway')).toHaveLength(0);
    expect(s.state.mode).toBe('off_hours');
    expect(s.db('updateSession').find((r) => r.id === id)).toMatchObject({ endReason: 'work_hours_end' });
  });

  it('pause then away: the paused session stays paused and closes with the day', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'A' });
    s.send({ type: 'PAUSE' });
    // break ignores away (P18) …
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 5), reason: 'idle' });
    expect(s.state.mode).toBe('working');
    s.tick(T(17));
    expect(s.db('updateSession').filter((r) => r.endReason === 'work_hours_end')).toHaveLength(2);
  });

  it('BOOT restores away and off-hours states', () => {
    const s = bootOpen();
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 10), reason: 'idle' });
    const away = new Sim();
    away.send({ type: 'BOOT', heartbeat: { tsMs: T(11, 10), state: s.state } }, T(11, 40));
    expect(away.state.mode).toBe('working');
    expect(visiblePrompt(away.state)!.type).toBe('away');

    const off = new Sim();
    off.send({ type: 'BOOT', heartbeat: { tsMs: T(9), state: initialState() } }, T(10, 5));
    expect(off.state.mode).toBe('working');
  });

  it('BOOT with a stale heartbeat during a break keeps the break running', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'A' });
    s.send({ type: 'START', kind: 'break' });
    const b = new Sim();
    b.send({ type: 'BOOT', heartbeat: { tsMs: T(11), state: s.state } }, T(12));
    expect(b.state.current!.kind).toBe('break');
    expect(b.state.prompts).toHaveLength(0);
  });

  it('SCHEDULE_CHANGED behaves like TICK; disabling today ends the day', () => {
    const s = bootOpen();
    s.windowFn = () => null;
    s.send({ type: 'SCHEDULE_CHANGED' }, T(11, 1));
    expect(s.state.mode).toBe('off_hours');
    expect(s.db('updateSession')[0]).toMatchObject({ endedMs: T(11, 1) });
  });

  it('KEEP_WORKING during work hours only extends the day; on a day off it starts at now', () => {
    const s = bootOpen();
    s.send({ type: 'KEEP_WORKING' }, T(16));
    expect(s.fx).toEqual([{ setDayOverride: { date: '2026-11-24', endMin: 17 * 60 + 30 } }]);
    const d = new Sim();
    d.send({ type: 'KEEP_WORKING' }, T(11, 0, 0, 28));
    expect(d.fx[0]).toEqual({ setDayOverride: { date: '2026-11-28', endMin: 11 * 60 + 30 } });
    expect(d.state.mode).toBe('working');
  });

  it('a working state with no current session starts one on TICK', () => {
    const s = new Sim();
    s.state = { ...initialState(), mode: 'working' };
    s.tick(T(11));
    expect(s.state.current!.kind).toBe('open');
  });

  it('reduce does not mutate its input state', () => {
    const s = bootOpen();
    const snap = structuredClone(s.state);
    reduce(s.state, { type: 'DONE' }, s.ctx());
    expect(s.state).toEqual(snap);
  });
});

describe('widgetView', () => {
  it('17. workdayPct across the day', () => {
    const s = new Sim();
    const at = (ms: number) => {
      s.now = ms;
      return s.view().workdayPct;
    };
    expect(at(T(10))).toBe(0);
    expect(at(T(13, 30))).toBe(50);
    expect(at(T(17))).toBe(100);
    expect(at(T(9))).toBe(0);
    expect(at(T(18))).toBe(100);
    expect(at(T(12, 0, 0, 29))).toBe(0); // Sunday, day off
  });

  it('passes through extras and away title', () => {
    const s = bootOpen();
    s.send({ type: 'LABEL', sessionId: s.state.current!.id, name: 'Emails' });
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 10), reason: 'idle' }, T(11, 10));
    const v = s.view({ productiveTodaySec: 3600, goalSec: 18000, isDistracted: true });
    expect(v).toMatchObject({
      mode: 'away',
      title: 'Emails',
      productiveTodaySec: 3600,
      isDistracted: true,
      timerSec: 600,
      progress: null,
    });
  });
});
