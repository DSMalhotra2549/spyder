// Daily report numbers (plan §10, P25–P27, P30). Everything is clipped to the local day.
import { categorize, type ActivityCategory, type Rule } from './categorize';
import type { MatchType } from './defaults';
import { addDays, dayStartFromKey } from './schedule';
import type { Settings } from './settings';
import type { AwayClassification, AwayReason, EndReason, Kind, SessionStatus, WorkWindow } from './types';

export interface DaySession {
  id: string;
  kind: Kind;
  name: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  plannedSec: number | null;
  status: SessionStatus;
  startedMs: number;
  endedMs: number | null;
  endReason: EndReason | null;
}

export interface DaySegment {
  sessionId: string;
  startMs: number;
  endMs: number | null; // null = open, counts up to nowMs
}

export interface DayAway {
  id: string;
  startMs: number;
  endMs: number;
  reason: AwayReason;
  classification: AwayClassification | null;
  label: string | null;
}

export interface DayActivity {
  startMs: number;
  endMs: number;
  exe: string;
  appName: string;
  title: string | null;
  domain: string | null;
  browser: 'chrome' | 'firefox' | 'edge' | null;
  isPrivate: boolean;
}

export interface DayFlag {
  tsMs: number;
  target: string;
  continuousSec: number;
  sessionId: string | null;
}

/** Rows touching the day. Segments must include every segment of the listed sessions. */
export interface DayData {
  sessions: DaySession[];
  segments: DaySegment[];
  away: DayAway[];
  activity: DayActivity[];
  flags: DayFlag[];
  window: WorkWindow | null;
  nowMs: number;
}

export interface AppRow {
  key: string;
  sec: number;
  pct: number;
  category: ActivityCategory;
  /** The rule a category change creates; null when the row can't be ruled (private browsing). */
  ruleTarget: { matchType: MatchType; pattern: string } | null;
}

export interface SessionLine {
  id: string;
  name: string | null;
  projectName: string | null;
  projectColor: string | null;
  kind: Kind;
  startMs: number;
  endMs: number | null;
  /** Time inside this day. */
  daySec: number;
  /** Whole session (all segments). */
  elapsedSec: number;
  plannedSec: number | null;
  overtimeSec: number;
  deltaSec: number | null;
  running: boolean;
}

export interface Block {
  startMs: number;
  endMs: number;
}

export interface DaySummary {
  date: string;
  dayStartMs: number;
  dayEndMs: number;
  window: WorkWindow | null;
  scheduledSec: number;
  workSec: number;
  breakSec: number;
  notWorkingSec: number;
  awayPendingSec: number;
  distractingSec: number;
  /** Work time split by the category of the activity it overlaps (no activity → none of these). */
  workByCategory: Record<ActivityCategory, number>;
  productiveSec: number;
  score: number | null;
  goalSec: number;
  goalMet: boolean;
  scope: 'work_hours' | 'all_day';
  apps: AppRow[];
  categoryTotals: Record<ActivityCategory, number>;
  sessions: SessionLine[];
  away: (DayAway & { sec: number })[];
  flags: DayFlag[];
  offHoursActivitySec: number;
  unlabelledCount: number;
  timeline: {
    segments: (Block & { sessionId: string; kind: Kind; name: string | null })[];
    away: (Block & { classification: AwayClassification | null; label: string | null })[];
    activity: (Block & { category: ActivityCategory; key: string })[];
  };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const sec = (ms: number) => Math.round(ms / 1000);

/** Grouping key for the apps & sites table (§10). */
export function appKey(a: DayActivity): string {
  if (a.isPrivate) return 'Private browsing';
  if (a.domain) return a.domain;
  if (a.browser === 'firefox' && a.title) return `Firefox: ${a.title}`;
  return a.appName;
}

function ruleTarget(a: DayActivity): AppRow['ruleTarget'] {
  if (a.isPrivate) return null;
  if (a.domain) return { matchType: 'domain', pattern: a.domain.toLowerCase() };
  if (a.browser === 'firefox' && a.title) return { matchType: 'title', pattern: a.title.toLowerCase() };
  return { matchType: 'app', pattern: a.exe.toLowerCase() };
}

export function daySummary(
  date: string,
  data: DayData,
  rules: Rule[],
  settings: Pick<Settings, 'goalSec' | 'appPercentScope'>,
): DaySummary {
  const d0 = dayStartFromKey(date);
  const d1 = addDays(d0, 1);
  const win = data.window;
  const kindOf = new Map(data.sessions.map((s) => [s.id, s.kind]));
  const segEnd = (g: DaySegment) => g.endMs ?? Math.max(g.startMs, data.nowMs);

  // Segments clipped to the day.
  const daySegs = data.segments
    .map((g) => ({ ...g, s: Math.max(g.startMs, d0), e: Math.min(segEnd(g), d1) }))
    .filter((g) => g.e > g.s);
  const work = daySegs.filter((g) => kindOf.get(g.sessionId) !== 'break');
  const brk = daySegs.filter((g) => kindOf.get(g.sessionId) === 'break');

  const awayDay = data.away
    .map((a) => ({ ...a, s: Math.max(a.startMs, d0), e: Math.min(a.endMs, d1) }))
    .filter((a) => a.e > a.s);
  const awayMs = (pred: (c: AwayClassification | null) => boolean) =>
    awayDay.filter((a) => pred(a.classification)).reduce((t, a) => t + a.e - a.s, 0);

  const segMs = (gs: typeof daySegs) => gs.reduce((t, g) => t + g.e - g.s, 0);
  const workMs = segMs(work) + awayMs((c) => c === 'meeting' || c === 'offline_work');
  const breakMs = segMs(brk) + awayMs((c) => c === 'break');

  const acts = data.activity
    .map((a) => ({ a, s: Math.max(a.startMs, d0), e: Math.min(a.endMs, d1), cat: categorize(a, rules) }))
    .filter((x) => x.e > x.s);

  const workCatMs: Record<ActivityCategory, number> = { productive: 0, neutral: 0, distracting: 0, uncategorized: 0 };
  for (const x of acts) for (const g of work) workCatMs[x.cat] += overlap(x.s, x.e, g.s, g.e);

  const workSec = sec(workMs);
  const distractingSec = sec(workCatMs.distracting);
  const productiveSec = workSec - distractingSec;
  const scheduledSec = win ? sec(Math.min(win.endMs, d1) - Math.max(win.startMs, d0)) : 0;

  // Apps & sites in scope.
  const scope: DaySummary['scope'] = settings.appPercentScope === 'work_hours' && win ? 'work_hours' : 'all_day';
  const [s0, s1] = scope === 'work_hours' && win ? [win.startMs, win.endMs] : [d0, d1];
  const groups = new Map<string, { ms: number; byCat: Map<ActivityCategory, number>; target: AppRow['ruleTarget'] }>();
  const categoryMs: Record<ActivityCategory, number> = { productive: 0, neutral: 0, distracting: 0, uncategorized: 0 };
  let offHoursMs = 0;
  for (const x of acts) {
    offHoursMs += x.e - x.s - (win ? overlap(x.s, x.e, win.startMs, win.endMs) : 0);
    const ms = overlap(x.s, x.e, s0, s1);
    if (ms <= 0) continue;
    const key = appKey(x.a);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ms: 0, byCat: new Map(), target: ruleTarget(x.a) }));
    g.ms += ms;
    g.byCat.set(x.cat, (g.byCat.get(x.cat) ?? 0) + ms);
    categoryMs[x.cat] += ms;
  }
  const totalMs = [...groups.values()].reduce((t, g) => t + g.ms, 0);
  const apps: AppRow[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      sec: sec(g.ms),
      pct: totalMs > 0 ? (g.ms / totalMs) * 100 : 0,
      // A group can mix categories (title rules); show the one with the most time.
      category: [...g.byCat.entries()].sort((a, b) => b[1] - a[1])[0][0],
      ruleTarget: g.target,
    }))
    .sort((a, b) => b.sec - a.sec || a.key.localeCompare(b.key));

  // Sessions touching the day.
  const sessions: SessionLine[] = data.sessions
    .map((s) => {
      const segs = data.segments.filter((g) => g.sessionId === s.id);
      const elapsedSec = sec(segs.reduce((t, g) => t + segEnd(g) - g.startMs, 0));
      const daySec = sec(daySegs.filter((g) => g.sessionId === s.id).reduce((t, g) => t + g.e - g.s, 0));
      const deltaSec = s.plannedSec !== null ? elapsedSec - s.plannedSec : null;
      return {
        id: s.id,
        name: s.name,
        projectName: s.projectName,
        projectColor: s.projectColor,
        kind: s.kind,
        startMs: s.startedMs,
        endMs: s.endedMs,
        daySec,
        elapsedSec,
        plannedSec: s.plannedSec,
        overtimeSec: Math.max(0, deltaSec ?? 0),
        deltaSec,
        running: s.endedMs === null,
      };
    })
    .filter((s) => s.daySec > 0 || (s.startMs >= d0 && s.startMs < d1))
    .sort((a, b) => a.startMs - b.startMs);

  return {
    date,
    dayStartMs: d0,
    dayEndMs: d1,
    window: win,
    scheduledSec,
    workSec,
    breakSec: sec(breakMs),
    notWorkingSec: sec(awayMs((c) => c === 'not_working')),
    awayPendingSec: sec(awayMs((c) => c === null)),
    distractingSec,
    workByCategory: {
      productive: sec(workCatMs.productive),
      neutral: sec(workCatMs.neutral),
      distracting: distractingSec,
      uncategorized: sec(workCatMs.uncategorized),
    },
    productiveSec,
    score: scheduledSec > 0 ? productiveSec / scheduledSec : null,
    goalSec: settings.goalSec,
    goalMet: productiveSec >= settings.goalSec,
    scope,
    apps,
    categoryTotals: {
      productive: sec(categoryMs.productive),
      neutral: sec(categoryMs.neutral),
      distracting: sec(categoryMs.distracting),
      uncategorized: sec(categoryMs.uncategorized),
    },
    sessions,
    away: awayDay
      .map(({ s, e, ...a }) => ({ ...a, startMs: s, endMs: e, sec: sec(e - s) }))
      .sort((a, b) => a.startMs - b.startMs),
    flags: data.flags.filter((f) => f.tsMs >= d0 && f.tsMs < d1).sort((a, b) => a.tsMs - b.tsMs),
    offHoursActivitySec: sec(offHoursMs),
    unlabelledCount: sessions.filter((s) => s.name === null && s.kind !== 'break' && !s.running).length,
    timeline: {
      segments: daySegs
        .map((g) => {
          const s = data.sessions.find((x) => x.id === g.sessionId);
          return { sessionId: g.sessionId, kind: s?.kind ?? 'open', name: s?.name ?? null, startMs: g.s, endMs: g.e };
        })
        .sort((a, b) => a.startMs - b.startMs),
      away: awayDay.map((a) => ({ startMs: a.s, endMs: a.e, classification: a.classification, label: a.label })),
      activity: acts.map((x) => ({ startMs: x.s, endMs: x.e, category: x.cat, key: appKey(x.a) })),
    },
  };
}
