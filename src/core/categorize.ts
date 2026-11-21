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

export function categorize(row: ActivityKey, rules: Rule[]): ActivityCategory {
  const sorted = [...rules].sort(byStrength);
  const title = row.title?.toLowerCase();
  if (title) {
    const r = sorted.find((x) => x.matchType === 'title' && title.includes(x.pattern));
    if (r) return r.category;
  }
  if (row.browser) {
    if (row.domain === null) return 'neutral';
    const d = row.domain.toLowerCase();
    const r = sorted.find((x) => x.matchType === 'domain' && (d === x.pattern || d.endsWith(`.${x.pattern}`)));
    // A site with no rule stays Uncategorized; the browser's own app rule doesn't apply to it (P12).
    return r ? r.category : 'uncategorized';
  }
  const exe = row.exe.toLowerCase();
  const r = sorted.find((x) => x.matchType === 'app' && x.pattern === exe);
  return r ? r.category : 'uncategorized';
}
