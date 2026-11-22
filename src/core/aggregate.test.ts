import { describe, expect, it } from 'vitest';
import { appKey, daySummary, type DayActivity, type DayData, type DaySession } from './aggregate';
import type { Rule } from './categorize';
import { DEFAULT_RULES } from './defaults';
import { leftovers } from './review';
import { streak } from './streaks';

// Fixture day: Tue 2026-11-24, work hours 10:00–17:00 (scheduled 7 h = 25 200 s).
const at = (h: number, m = 0, day = 24) => new Date(2026, 10, day, h, m).getTime();
const rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
const S = { goalSec: 18_000, appPercentScope: 'work_hours' as const };

const ses = (id: string, kind: DaySession['kind'], name: string | null, startedMs: number, endedMs: number | null, plannedSec: number | null = null): DaySession => ({
  id, kind, name, projectId: null, projectName: null, projectColor: null, plannedSec,
  status: endedMs === null ? 'running' : 'done', startedMs, endedMs, endReason: endedMs === null ? null : 'done',
});
const act = (s: number, e: number, o: Partial<DayActivity>): DayActivity => ({
  startMs: s, endMs: e, exe: 'code.exe', appName: 'VS Code', title: 't', domain: null, browser: null, isPrivate: false, ...o,
});
const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', browser: 'chrome' as const };

function fixture(): DayData {
  return {
    window: { startMs: at(10), endMs: at(17) },
    nowMs: at(9, 0, 25),
    sessions: [
      ses('F', 'open', 'Night owl', at(23, 0, 23), at(0, 20)), // crosses into the day: 20 min today
      ses('A', 'planned', 'Emails', at(10), at(10, 40), 1800), // 40 min, 10 min over
      ses('B', 'open', 'Coding', at(10, 40), at(13, 30)), // 80 + 60 min
      ses('C', 'break', null, at(12), at(12, 30)), // 30 min break
      ses('D', 'open', null, at(13, 30), at(14)), // 30 min, unlabelled
      ses('E', 'open', 'Late', at(23, 30), at(0, 30, 25)), // crosses midnight: 30 min today
    ],
    segments: [
      { sessionId: 'F', startMs: at(23, 0, 23), endMs: at(0, 20) },
      { sessionId: 'A', startMs: at(10), endMs: at(10, 40) },
      { sessionId: 'B', startMs: at(10, 40), endMs: at(12) },
      { sessionId: 'C', startMs: at(12), endMs: at(12, 30) },
      { sessionId: 'B', startMs: at(12, 30), endMs: at(13, 30) },
      { sessionId: 'D', startMs: at(13, 30), endMs: at(14) },
      { sessionId: 'E', startMs: at(23, 30), endMs: at(0, 30, 25) },
    ],
    away: [
      { id: 'a1', startMs: at(14), endMs: at(14, 30), reason: 'idle', classification: 'meeting', label: null },
      { id: 'a2', startMs: at(14, 30), endMs: at(14, 45), reason: 'idle', classification: 'break', label: null },
      { id: 'a3', startMs: at(14, 45), endMs: at(15), reason: 'lock', classification: 'offline_work', label: 'Sketch' },
      { id: 'a4', startMs: at(15), endMs: at(15, 10), reason: 'idle', classification: 'not_working', label: null },
      { id: 'a5', startMs: at(15, 10), endMs: at(15, 20), reason: 'idle', classification: null, label: null },
      // 'working' is counted through its segment, never as away time.
      { id: 'a6', startMs: at(15, 20), endMs: at(15, 30), reason: 'idle', classification: 'working', label: null },
    ],
    activity: [
      act(at(10), at(10, 40), { exe: 'notepad.exe', appName: 'Notepad' }),
      act(at(10, 40), at(11), {}),
      act(at(11), at(11, 10), { ...yt, title: 'Lofi - YouTube' }), // distracting, in session B
      act(at(11, 10), at(12), {}),
      act(at(12, 5), at(12, 15), { ...yt, title: 'Cats - YouTube' }), // distracting but in a break
      act(at(12, 30), at(12, 40), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', title: 'Some blog post' }),
      act(at(12, 40), at(12, 50), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', title: null, isPrivate: true }),
      act(at(17, 30), at(17, 50), { exe: 'chrome.exe', appName: 'Google Chrome', browser: 'chrome', domain: 'reddit.com' }), // off hours
      act(at(23, 30), at(23, 50), {}), // off hours
      act(at(23, 50), at(0, 10, 25), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', domain: 'youtube.com', title: 'x' }), // 10 min today, in E
    ],
    flags: [
      { tsMs: at(23, 10, 23), target: 'reddit.com', continuousSec: 300, sessionId: 'F' }, // previous day
      { tsMs: at(11, 5), target: 'youtube.com', continuousSec: 300, sessionId: 'B' },
    ],
  };
}

describe('daySummary', () => {
  const d = daySummary('2026-11-24', fixture(), rules, S);

  it('totals', () => {
    expect(d.scheduledSec).toBe(25_200);
    // Segments 20 + 40 + 140 + 30 + 30 = 260 min, plus meeting 30 + offline work 15.
    expect(d.workSec).toBe(305 * 60);
    expect(d.breakSec).toBe(45 * 60); // break session 30 + away break 15
    expect(d.notWorkingSec).toBe(600);
    expect(d.awayPendingSec).toBe(600);
    expect(d.distractingSec).toBe(20 * 60); // 11:00–11:10 in B and 23:50–24:00 in E; the break one doesn't count
    expect(d.productiveSec).toBe(285 * 60);
    // Work ∩ activity: VS Code 70 (in B) + 20 (in E) + Notepad 40 productive; Firefox blog + private 20 neutral; YouTube 20.
    expect(d.workByCategory).toEqual({ productive: 130 * 60, neutral: 20 * 60, distracting: 20 * 60, uncategorized: 0 });
    expect(d.score).toBeCloseTo(17_100 / 25_200, 10);
    expect(d.goalMet).toBe(false);
    expect(daySummary('2026-11-24', fixture(), rules, { ...S, goalSec: 17_100 }).goalMet).toBe(true);
  });

  it('apps table in work-hours scope sums to 100 %', () => {
    expect(d.scope).toBe('work_hours');
    expect(d.apps.map((a) => [a.key, a.sec, Number(a.pct.toFixed(3)), a.category])).toEqual([
      ['VS Code', 4200, 46.667, 'productive'],
      ['Notepad', 2400, 26.667, 'productive'],
      ['youtube.com', 1200, 13.333, 'distracting'],
      ['Firefox: Some blog post', 600, 6.667, 'neutral'],
      ['Private browsing', 600, 6.667, 'neutral'],
    ]);
    expect(Math.abs(d.apps.reduce((t, a) => t + a.pct, 0) - 100)).toBeLessThan(0.1);
    expect(d.apps.find((a) => a.key === 'Private browsing')!.ruleTarget).toBeNull();
    expect(d.apps.find((a) => a.key.startsWith('Firefox:'))!.ruleTarget).toEqual({ matchType: 'title', pattern: 'some blog post' });
    expect(d.apps[0].ruleTarget).toEqual({ matchType: 'app', pattern: 'code.exe' });
    expect(d.categoryTotals).toEqual({ productive: 6600, neutral: 1200, distracting: 1200, uncategorized: 0 });
  });

  it('off-hours activity is excluded from the work-hours scope but reported', () => {
    expect(d.apps.some((a) => a.key === 'reddit.com')).toBe(false);
    expect(d.offHoursActivitySec).toBe(50 * 60); // reddit 20 + code 20 + firefox 10
    const all = daySummary('2026-11-24', fixture(), rules, { ...S, appPercentScope: 'all_day' });
    expect(all.scope).toBe('all_day');
    expect(all.apps.map((a) => [a.key, a.sec])).toEqual([
      ['VS Code', 90 * 60],
      ['Notepad', 40 * 60],
      ['youtube.com', 30 * 60],
      ['reddit.com', 20 * 60],
      ['Firefox: Some blog post', 600],
      ['Private browsing', 600],
    ]);
    expect(Math.abs(all.apps.reduce((t, a) => t + a.pct, 0) - 100)).toBeLessThan(0.1);
  });

  it('Spyder, dev Electron and shell overlays are never counted (P44)', () => {
    const f = fixture();
    const base = daySummary('2026-11-24', f, rules, S);
    f.activity.push(
      act(at(16), at(16, 10), { exe: 'Spyder.exe', appName: 'Spyder' }),
      act(at(16, 10), at(16, 15), { exe: 'electron.exe', appName: 'Electron' }),
      act(at(16, 15), at(16, 16), { exe: 'ScreenClippingHost.exe', appName: 'ScreenClippingHost.exe' }),
    );
    const d2 = daySummary('2026-11-24', f, rules, S);
    expect(d2.apps).toEqual(base.apps);
    expect(d2.categoryTotals).toEqual(base.categoryTotals);
    expect(d2.timeline.activity).toEqual(base.timeline.activity);
  });

  it('a day off uses the whole day as scope and has no score', () => {
    const off = daySummary('2026-11-24', { ...fixture(), window: null }, rules, S);
    expect(off.scheduledSec).toBe(0);
    expect(off.score).toBeNull();
    expect(off.scope).toBe('all_day');
    expect(off.offHoursActivitySec).toBe(off.apps.reduce((t, a) => t + a.sec, 0));
  });

  it('midnight-crossing intervals are split at local midnight', () => {
    const f = d.sessions.find((s) => s.id === 'F')!;
    expect([f.daySec, f.elapsedSec]).toEqual([1200, 4800]);
    const e = d.sessions.find((s) => s.id === 'E')!;
    expect([e.daySec, e.elapsedSec]).toEqual([1800, 3600]);
    const next = daySummary('2026-11-25', fixture(), rules, S);
    expect(next.workSec).toBe(1800); // E's 00:00–00:30
    expect(next.distractingSec).toBe(600); // firefox youtube 00:00–00:10
    expect(next.sessions.map((s) => s.id)).toEqual(['E']);
  });

  it('sessions, flags, unlabelled count', () => {
    expect(d.sessions.map((s) => s.id)).toEqual(['F', 'A', 'B', 'C', 'D', 'E']);
    const a = d.sessions.find((s) => s.id === 'A')!;
    expect([a.elapsedSec, a.plannedSec, a.deltaSec, a.overtimeSec]).toEqual([2400, 1800, 600, 600]);
    expect(d.sessions.find((s) => s.id === 'B')!.deltaSec).toBeNull();
    expect(d.flags.map((f) => f.target)).toEqual(['youtube.com']);
    expect(d.unlabelledCount).toBe(1); // D; C is a break
    expect(leftovers(d)).toBe(2); // D plus the pending away period a5
    expect(d.away).toHaveLength(6);
    expect(d.timeline.segments).toHaveLength(7);
  });

  it('an open segment counts up to now', () => {
    const data: DayData = {
      window: { startMs: at(10), endMs: at(17) },
      nowMs: at(11, 15),
      sessions: [ses('X', 'open', null, at(11), null)],
      segments: [{ sessionId: 'X', startMs: at(11), endMs: null }],
      away: [],
      activity: [],
      flags: [],
    };
    const r = daySummary('2026-11-24', data, rules, S);
    expect(r.workSec).toBe(900);
    expect(r.sessions[0].running).toBe(true);
    expect(r.unlabelledCount).toBe(0); // still running
  });

  it('appKey', () => {
    expect(appKey(act(0, 1, { browser: 'chrome', domain: null, appName: 'Google Chrome' }))).toBe('Google Chrome');
  });
});

describe('streak', () => {
  // 2026-11-24 is a Tuesday.
  const days = (met: Record<string, boolean>) => (k: string) => {
    const wd = new Date(`${k}T12:00:00`).getDay();
    return { scheduled: wd >= 1 && wd <= 5, goalMet: met[k] ?? false };
  };
  it('counts met scheduled days and skips weekends', () => {
    const met = { '2026-11-24': true, '2026-11-23': true, '2026-11-20': true, '2026-11-19': true, '2026-11-18': true };
    expect(streak('2026-11-24', days(met))).toBe(5);
  });
  it('a missed weekday breaks it', () => {
    expect(streak('2026-11-24', days({ '2026-11-24': true, '2026-11-20': true }))).toBe(1);
  });
  it('a missed Wednesday breaks it', () => {
    // Mon 23, Tue 24 met; Wed 18 missed; Thu 19, Fri 20 met.
    const met = { '2026-11-24': true, '2026-11-23': true, '2026-11-20': true, '2026-11-19': true };
    expect(streak('2026-11-24', days(met))).toBe(4);
    expect(streak('2026-11-24', days({ ...met, '2026-11-18': true, '2026-11-17': true }))).toBe(6);
  });
  it('today not yet met is skipped', () => {
    expect(streak('2026-11-24', days({ '2026-11-23': true, '2026-11-20': true }))).toBe(2);
  });
  it('caps at 366', () => {
    expect(streak('2026-11-24', () => ({ scheduled: true, goalMet: true }))).toBe(366);
  });
});
