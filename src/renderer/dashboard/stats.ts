// Text shown in the Today stat header (pure, so e2e tests format the same numbers the same way).
import type { DaySummary } from '../../core/aggregate';
import { fmtDuration, fmtHM } from '../../core/format';
import { rangeStats, type DayLite } from '../../core/trends';

/** Report durations: `5h 12m`, `38m`, `0m` (no seconds in reports). */
export const dur = (sec: number) => (sec < 60 ? `${Math.max(0, Math.round(sec / 60))}m` : fmtDuration(sec));
export const pct = (score: number | null) => (score === null ? '—' : `${Math.round(score * 100)}%`);
export const appPct = (p: number) => `${p.toFixed(1)}%`;

export function statTexts(s: DaySummary, streak: number) {
  return {
    work: dur(s.workSec),
    workSub: s.breakSec > 0 ? `${dur(s.breakSec)} break` : 'no breaks',
    productive: dur(s.productiveSec),
    productiveSub: `of ${dur(s.goalSec)} goal${s.goalMet ? ' · met' : ''}`,
    score: pct(s.score),
    scoreSub: s.scheduledSec > 0 ? `of ${dur(s.scheduledSec)} scheduled` : 'day off',
    streak: `${streak} ${streak === 1 ? 'day' : 'days'}`,
    distractions: String(s.flags.length),
    distractionsSub: `${dur(s.distractingSec)} distracting`,
  };
}

export const appTexts = (a: DaySummary['apps'][number]) => ({ key: a.key, time: fmtHM(a.sec), pct: appPct(a.pct) });

/** Texts of the Week / Month stat row. */
export function rangeTexts(days: DayLite[]) {
  const r = rangeStats(days);
  const tracked = days.filter((d) => !d.future && d.workSec > 0).length;
  return {
    work: dur(r.workSec),
    workSub: `${tracked} ${tracked === 1 ? 'day' : 'days'} tracked`,
    productive: dur(r.productiveSec),
    productiveSub: r.workSec > 0 ? `${Math.round((r.productiveSec / r.workSec) * 100)}% of work time` : 'no work yet',
    score: pct(r.avgScore),
    goals: `${r.goalsHit}/${r.goalDays}`,
  };
}
