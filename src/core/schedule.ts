// Work-hours helpers (P10, P11). Days are local calendar days (P30).
import type { ScheduleRow } from './settings';
import type { WorkWindow } from './types';

export interface DayOverride {
  date: string; // YYYY-MM-DD local
  enabled: boolean;
  startMin: number;
  endMin: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local 'YYYY-MM-DD' for an instant. */
export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Epoch ms of local midnight starting the day of `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Epoch ms of local midnight for a 'YYYY-MM-DD' key. */
export function dayStartFromKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Adds whole local days (DST-safe). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/** Minutes since local midnight (floored). */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Local instant for (day of `ms`, minute-of-day). DST-safe: uses the Date constructor. */
export function atMinute(ms: number, minute: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
}

/** Work window for the local day containing dateMs, after overrides; null on a day off. */
export function workWindow(
  dateMs: number,
  schedule: ScheduleRow[],
  overrides: DayOverride[] | Map<string, DayOverride>,
): WorkWindow | null {
  const key = dateKey(dateMs);
  const ov = overrides instanceof Map ? overrides.get(key) : overrides.find((o) => o.date === key);
  const row = ov ?? schedule.find((r) => r.weekday === new Date(dateMs).getDay());
  if (!row || !row.enabled || row.endMin <= row.startMin) return null;
  return { startMs: atMinute(dateMs, row.startMin), endMs: atMinute(dateMs, row.endMin) };
}

export function inWork(now: number, win: WorkWindow | null): boolean {
  return !!win && win.startMs <= now && now < win.endMs;
}

/** Share of today's work hours elapsed, 0–100 (P11). 0 on a day off. */
export function workdayPct(now: number, win: WorkWindow | null): number {
  if (!win) return 0;
  const pct = ((now - win.startMs) / (win.endMs - win.startMs)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Next work-hours start or end strictly after `now`, searching up to 8 days ahead. */
export function nextBoundary(now: number, windowOf: (dateMs: number) => WorkWindow | null): number | null {
  for (let i = 0; i < 8; i++) {
    const w = windowOf(addDays(startOfDay(now), i));
    if (!w) continue;
    if (w.startMs > now) return w.startMs;
    if (w.endMs > now) return w.endMs;
  }
  return null;
}

/**
 * P32: merges an engine `setDayOverride{endMin}` into today's window. The start is pulled back to
 * `nowMin` if work starts earlier than scheduled; the end never shrinks.
 */
export function mergeOverride(
  current: { startMin: number; endMin: number } | null,
  nowMin: number,
  endMin: number,
): { enabled: true; startMin: number; endMin: number } {
  if (!current) return { enabled: true, startMin: nowMin, endMin: Math.min(endMin, 1440) };
  return {
    enabled: true,
    startMin: Math.min(current.startMin, nowMin),
    endMin: Math.min(Math.max(current.endMin, endMin), 1440),
  };
}
