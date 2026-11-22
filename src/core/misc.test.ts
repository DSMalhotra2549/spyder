import { describe, expect, it } from 'vitest';
import { T } from './engine.testkit';
import { fmtClock, fmtDuration, fmtHM, fmtTime } from './format';
import { initialNudge, nudgeMessage, stepNudge, type NudgeSample, type NudgeState } from './nudge';
import {
  addDays,
  dateKey,
  dayStartFromKey,
  inWork,
  mergeOverride,
  nextBoundary,
  startOfDay,
  workWindow,
} from './schedule';
import { DEFAULT_SCHEDULE, DEFAULT_SETTINGS } from './settings';

describe('schedule', () => {
  it('work windows with overrides and days off', () => {
    expect(workWindow(T(12), DEFAULT_SCHEDULE, [])).toEqual({ startMs: T(10), endMs: T(17) });
    expect(workWindow(T(12, 0, 0, 28), DEFAULT_SCHEDULE, [])).toBeNull();
    const ov = [{ date: '2026-11-24', enabled: true, startMin: 540, endMin: 1080 }];
    expect(workWindow(T(12), DEFAULT_SCHEDULE, ov)).toEqual({ startMs: T(9), endMs: T(18) });
    expect(workWindow(T(12), DEFAULT_SCHEDULE, [{ ...ov[0], enabled: false }])).toBeNull();
    expect(workWindow(T(12), DEFAULT_SCHEDULE, new Map([['2026-11-24', ov[0]]]))).toEqual({
      startMs: T(9),
      endMs: T(18),
    });
    expect(workWindow(T(12), [], [])).toBeNull();
  });

  it('inWork boundaries', () => {
    const w = { startMs: T(10), endMs: T(17) };
    expect(inWork(T(10), w)).toBe(true);
    expect(inWork(T(17), w)).toBe(false);
    expect(inWork(T(12), null)).toBe(false);
  });

  it('nextBoundary', () => {
    const wf = (ms: number) => workWindow(ms, DEFAULT_SCHEDULE, []);
    expect(nextBoundary(T(9), wf)).toBe(T(10));
    expect(nextBoundary(T(12), wf)).toBe(T(17));
    expect(nextBoundary(T(18), wf)).toBe(T(10, 0, 0, 25));
    expect(nextBoundary(T(18, 0, 0, 27), wf)).toBe(T(10, 0, 0, 30)); // Fri evening → Monday
    expect(nextBoundary(T(12), () => null)).toBeNull();
  });

  it('date helpers', () => {
    expect(dateKey(T(23, 59))).toBe('2026-11-24');
    expect(startOfDay(T(15))).toBe(T(0));
    expect(dayStartFromKey('2026-11-24')).toBe(T(0));
    expect(addDays(T(15), 2)).toBe(T(15, 0, 0, 26));
  });

  it('mergeOverride (P32)', () => {
    expect(mergeOverride(null, 660, 690)).toEqual({ enabled: true, startMin: 660, endMin: 690 });
    expect(mergeOverride({ startMin: 600, endMin: 1020 }, 480, 510)).toEqual({ enabled: true, startMin: 480, endMin: 1020 });
    expect(mergeOverride({ startMin: 600, endMin: 1020 }, 1020, 1050)).toEqual({
      enabled: true,
      startMin: 600,
      endMin: 1050,
    });
    expect(mergeOverride({ startMin: 600, endMin: 1020 }, 1430, 1460).endMin).toBe(1440);
  });
});

describe('format', () => {
  it('clock, h:mm, durations, time', () => {
    expect(fmtClock(59)).toBe('00:59');
    expect(fmtClock(30 * 60)).toBe('30:00');
    expect(fmtClock(3723)).toBe('1:02:03');
    expect(fmtClock(-5)).toBe('00:00');
    expect(fmtHM(3600 + 5 * 60)).toBe('1:05');
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(38 * 60)).toBe('38m');
    expect(fmtDuration(72 * 60)).toBe('1h 12m');
    expect(fmtDuration(7200)).toBe('2h');
    expect(fmtTime(T(9, 5))).toBe('09:05');
  });
});

describe('nudge (18)', () => {
  const cfg = DEFAULT_SETTINGS;
  function run(samples: Omit<NudgeSample, 'target'>[]) {
    let st: NudgeState = initialNudge();
    const nudges: number[] = [];
    let distracted = false;
    for (const s of samples) {
      const r = stepNudge(st, { ...s, target: 'youtube.com' }, cfg);
      st = r.state;
      distracted = r.isDistracted;
      if (r.nudge) nudges.push(r.nudge.continuousSec);
    }
    return { nudges, distracted, st };
  }
  const seq = (fromSec: number, toSec: number, category: NudgeSample['category'], inWorkSession = true) =>
    Array.from({ length: (toSec - fromSec) / 2 + 1 }, (_, i) => ({
      tsMs: (fromSec + i * 2) * 1000,
      category,
      inWorkSession,
    }));

  it('5 min distracting → nudge; another 5 min → second nudge', () => {
    const r = run(seq(0, 600, 'distracting'));
    expect(r.nudges).toEqual([300, 600]);
    expect(r.distracted).toBe(true);
    expect(run(seq(0, 298, 'distracting')).distracted).toBe(false);
  });

  it('a 30 s switch away does not reset; a 60 s one does', () => {
    const short = run([...seq(0, 200, 'distracting'), ...seq(202, 230, 'productive'), ...seq(232, 300, 'distracting')]);
    expect(short.nudges).toEqual([300]);
    const long = run([...seq(0, 200, 'distracting'), ...seq(202, 262, 'productive'), ...seq(264, 300, 'distracting')]);
    expect(long.nudges).toEqual([]);
    expect(long.st.distractStartMs).toBe(264_000);
  });

  it('never outside a work session', () => {
    expect(run(seq(0, 900, 'distracting', false)).nudges).toEqual([]);
  });

  it('message', () => {
    expect(nudgeMessage('youtube.com', 360)).toBe(
      `You're on youtube.com while your block is running (6 min)`,
    );
    expect(nudgeMessage('reddit.com', 10)).toContain('(1 min)');
  });
});
