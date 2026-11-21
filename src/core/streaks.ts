// Streak (plan §10, P27): consecutive scheduled days with the goal met, walking back from today.
import { addDays, dateKey, dayStartFromKey } from './schedule';

export interface StreakDay {
  scheduled: boolean;
  goalMet: boolean;
}

/** `day(key)` is called lazily, newest first, so callers only load the days the walk reaches. */
export function streak(today: string, day: (key: string) => StreakDay): number {
  let n = 0;
  let ms = dayStartFromKey(today);
  // The iteration limit only matters when no day is ever scheduled.
  for (let i = 0; i < 2000 && n < 366; i++, ms = addDays(ms, -1)) {
    const key = dateKey(ms);
    const d = day(key);
    if (!d.scheduled) continue;
    if (d.goalMet) n++;
    else if (key !== today) break;
  }
  return n;
}
