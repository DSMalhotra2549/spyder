// Week and Month numbers (plan §12 Week/Month), built from per-day summaries (§10).
import type { AppRow, DaySummary } from './aggregate';
import type { ActivityCategory } from './categorize';
import { addDays, dateKey, dayStartFromKey } from './schedule';

/** Bar stacks for one day (P38). The four work stacks sum to workSec. */
export interface DayStacks {
  productive: number;
  neutral: number;
  distracting: number;
  uncategorized: number;
  break: number;
  away: number;
}

export interface PlannedLine {
  id: string;
  name: string | null;
  plannedSec: number;
  actualSec: number;
  deltaSec: number;
  startMs: number;
}

/** What the Week and Month pages need from one day (small enough to send for a month). */
export interface DayLite {
  date: string;
  future: boolean;
  scheduled: boolean;
  scheduledSec: number;
  workSec: number;
  productiveSec: number;
  distractingSec: number;
  score: number | null;
  goalSec: number;
  goalMet: boolean;
  stacks: DayStacks;
  apps: AppRow[];
  planned: PlannedLine[];
}

export const STACK_KEYS = ['productive', 'neutral', 'uncategorized', 'distracting', 'break', 'away'] as const;

export function stacksOf(s: DaySummary): DayStacks {
  const w = s.workByCategory;
  return {
    // Work with no activity (meetings, offline work, gaps) counts as productive, as in P25.
    productive: Math.max(0, s.workSec - w.neutral - w.uncategorized - w.distracting),
    neutral: w.neutral,
    distracting: w.distracting,
    uncategorized: w.uncategorized,
    break: s.breakSec,
    away: s.notWorkingSec + s.awayPendingSec,
  };
}

export const stackTotal = (st: DayStacks) => STACK_KEYS.reduce((t, k) => t + st[k], 0);

export function dayLite(s: DaySummary, today: string): DayLite {
  return {
    date: s.date,
    future: s.date > today,
    scheduled: s.window !== null,
    scheduledSec: s.scheduledSec,
    workSec: s.workSec,
    productiveSec: s.productiveSec,
    distractingSec: s.distractingSec,
    score: s.score,
    goalSec: s.goalSec,
    goalMet: s.goalMet,
    stacks: stacksOf(s),
    apps: s.apps,
    // Sessions that started this day, so one crossing midnight is listed once.
    planned: s.sessions
      .filter((x) => x.plannedSec !== null && x.kind !== 'break' && !x.running && x.startMs >= s.dayStartMs)
      .map((x) => ({
        id: x.id,
        name: x.name,
        plannedSec: x.plannedSec!,
        actualSec: x.elapsedSec,
        deltaSec: x.elapsedSec - x.plannedSec!,
        startMs: x.startMs,
      })),
  };
}

export interface RangeStats {
  workSec: number;
  productiveSec: number;
  /** Mean score over scheduled days up to today; null if none. */
  avgScore: number | null;
  goalsHit: number;
  goalDays: number;
}

export function rangeStats(days: DayLite[]): RangeStats {
  const past = days.filter((d) => !d.future);
  const scored = past.filter((d) => d.scheduled && d.score !== null);
  const sched = past.filter((d) => d.scheduled);
  return {
    workSec: past.reduce((t, d) => t + d.workSec, 0),
    productiveSec: past.reduce((t, d) => t + d.productiveSec, 0),
    avgScore: scored.length ? scored.reduce((t, d) => t + d.score!, 0) / scored.length : null,
    goalsHit: sched.filter((d) => d.goalMet).length,
    goalDays: sched.length,
  };
}

/** Apps & sites over several days; each row keeps the category with the most time. */
export function topApps(days: DayLite[], n: number): AppRow[] {
  const m = new Map<string, { sec: number; byCat: Map<ActivityCategory, number>; target: AppRow['ruleTarget'] }>();
  for (const d of days)
    for (const a of d.apps) {
      let g = m.get(a.key);
      if (!g) m.set(a.key, (g = { sec: 0, byCat: new Map(), target: a.ruleTarget }));
      g.sec += a.sec;
      g.byCat.set(a.category, (g.byCat.get(a.category) ?? 0) + a.sec);
    }
  const total = [...m.values()].reduce((t, g) => t + g.sec, 0);
  return [...m.entries()]
    .map(([key, g]) => ({
      key,
      sec: g.sec,
      pct: total > 0 ? (g.sec / total) * 100 : 0,
      category: [...g.byCat.entries()].sort((a, b) => b[1] - a[1])[0][0],
      ruleTarget: g.target,
    }))
    .sort((a, b) => b.sec - a.sec || a.key.localeCompare(b.key))
    .slice(0, n);
}

/** Planned sessions in the range, oldest first, with the total estimate error. */
export function estimates(days: DayLite[]): { rows: PlannedLine[]; plannedSec: number; actualSec: number } {
  const rows = days.flatMap((d) => d.planned).sort((a, b) => a.startMs - b.startMs);
  return {
    rows,
    plannedSec: rows.reduce((t, r) => t + r.plannedSec, 0),
    actualSec: rows.reduce((t, r) => t + r.actualSec, 0),
  };
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const ms = dayStartFromKey(date);
  const wd = new Date(ms).getDay();
  return dateKey(addDays(ms, -((wd + 6) % 7)));
}

export function weekDates(date: string): string[] {
  const m = dayStartFromKey(weekStart(date));
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(m, i)));
}

export function monthDates(date: string): string[] {
  const [y, mo] = date.split('-').map(Number);
  const n = new Date(y, mo, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${date.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`);
}

/** The same day of the month `n` months away, clamped to the month's length. */
export function addMonths(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  const first = new Date(y, mo - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dateKey(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)).getTime());
}

export interface KpiPoint {
  date: string;
  kpiId: string;
  value: number;
}

export interface RangeVM {
  from: string;
  to: string;
  today: string;
  days: DayLite[];
  streak: number;
  kpis: { id: string; name: string; unit: string | null }[];
  kpiValues: KpiPoint[];
}
