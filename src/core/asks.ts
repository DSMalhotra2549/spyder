// Apps and sites waiting for the user's own label (P70): no rule yet, or only a default one.
import { appKey, ruleTarget, type ActivityFacts, type AppRow } from './aggregate';
import { decide, type ActivityCategory, type Rule } from './categorize';
import { isIgnoredExe } from './defaults';

/** Less time than this isn't worth asking about. */
export const ASK_MIN_SEC = 180;

export interface AskRow {
  key: string;
  sec: number;
  /** The category it has now (the one with the most time). */
  category: ActivityCategory;
  ruleTarget: NonNullable<AppRow['ruleTarget']>;
}

/** Rows grouped like the apps & sites table, most time first. */
export function toAsk(rows: (ActivityFacts & { ms: number })[], rules: Rule[], minSec = ASK_MIN_SEC): AskRow[] {
  const groups = new Map<string, { ms: number; open: boolean; byCat: Map<ActivityCategory, number>; target: AskRow['ruleTarget'] }>();
  for (const r of rows) {
    const target = ruleTarget(r);
    if (!target || isIgnoredExe(r.exe) || r.ms <= 0) continue;
    // A browser page with no site is Neutral, and an app rule can't change that.
    if (r.browser && !r.domain && target.matchType === 'app') continue;
    const d = decide(r, rules);
    const key = appKey(r);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ms: 0, open: false, byCat: new Map(), target }));
    g.ms += r.ms;
    g.byCat.set(d.category, (g.byCat.get(d.category) ?? 0) + r.ms);
    // Answered once the user's own rule decides it (a rule they made, even one matching the default).
    if (d.by === 'none' || d.by === 'default') g.open = true;
  }
  return [...groups.entries()]
    .filter(([, g]) => g.open && g.ms / 1000 >= minSec)
    .map(([key, g]) => ({
      key,
      sec: Math.round(g.ms / 1000),
      category: [...g.byCat.entries()].sort((a, b) => b[1] - a[1])[0][0],
      ruleTarget: g.target,
    }))
    .sort((a, b) => b.sec - a.sec || a.key.localeCompare(b.key));
}
