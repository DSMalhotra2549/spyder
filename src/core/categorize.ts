// Categorization at read time (plan §9.4, ADR-0005).
import type { Category, MatchType } from './defaults';

export type ActivityCategory = Category | 'uncategorized';

export interface Rule {
  matchType: MatchType;
  pattern: string; // lowercase
  category: Category;
  isDefault: boolean;
}

export interface ActivityKey {
  exe: string;
  domain: string | null;
  title: string | null;
  browser: 'chrome' | 'firefox' | 'edge' | null;
}

/** User rules first, then longest pattern. */
const byStrength = (a: Rule, b: Rule) =>
  Number(a.isDefault) - Number(b.isDefault) || b.pattern.length - a.pattern.length;

/** Which kind of rule settled a row's category, or none. */
export type DecidedBy = 'user' | 'default' | 'none';

export function decide(row: ActivityKey, rules: Rule[]): { category: ActivityCategory; by: DecidedBy } {
  const sorted = [...rules].sort(byStrength);
  const by = (r: Rule | undefined) =>
    r ? { category: r.category, by: r.isDefault ? ('default' as const) : ('user' as const) } : { category: 'uncategorized' as const, by: 'none' as const };
  const title = row.title?.toLowerCase();
  if (title) {
    const r = sorted.find((x) => x.matchType === 'title' && title.includes(x.pattern));
    if (r) return by(r);
  }
  if (row.browser) {
    if (row.domain === null) return { category: 'neutral', by: 'none' };
    const d = row.domain.toLowerCase();
    // A site with no rule stays Uncategorized; the browser's own app rule doesn't apply to it (P12).
    return by(sorted.find((x) => x.matchType === 'domain' && (d === x.pattern || d.endsWith(`.${x.pattern}`))));
  }
  const exe = row.exe.toLowerCase();
  return by(sorted.find((x) => x.matchType === 'app' && x.pattern === exe));
}

export function categorize(row: ActivityKey, rules: Rule[]): ActivityCategory {
  return decide(row, rules).category;
}
