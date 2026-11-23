import { describe, expect, it } from 'vitest';
import { toAsk } from './asks';
import type { ActivityFacts } from './aggregate';
import type { Rule } from './categorize';
import { DEFAULT_RULES } from './defaults';

const defaults: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
const user = (matchType: Rule['matchType'], pattern: string, category: Rule['category']): Rule => ({ matchType, pattern, category, isDefault: false });
const MIN = 60_000;
type Row = ActivityFacts & { ms: number };
const app = (exe: string, appName: string, ms: number): Row => ({ exe, appName, domain: null, title: null, browser: null, isPrivate: false, ms });
const site = (domain: string | null, ms: number, o: Partial<Row> = {}): Row => ({
  exe: 'chrome.exe', appName: 'Google Chrome', domain, title: null, browser: 'chrome', isPrivate: false, ms, ...o,
});

describe('toAsk (P70)', () => {
  it('asks about unlabelled and default-labelled apps and sites, most time first', () => {
    const rows = toAsk([app('random.exe', 'Random', 10 * MIN), site('youtube.com', 30 * MIN), app('code.exe', 'VS Code', 20 * MIN)], defaults);
    expect(rows.map((r) => [r.key, r.category])).toEqual([
      ['youtube.com', 'distracting'],
      ['VS Code', 'productive'],
      ['Random', 'uncategorized'],
    ]);
    expect(rows[0].ruleTarget).toEqual({ matchType: 'domain', pattern: 'youtube.com' });
    expect(rows[0].sec).toBe(1800);
  });

  it('stops asking once a rule of the user decides it, even one matching the default', () => {
    const rules = [...defaults, user('domain', 'youtube.com', 'distracting'), user('app', 'random.exe', 'neutral')];
    expect(toAsk([site('youtube.com', 30 * MIN), app('random.exe', 'Random', 10 * MIN)], rules)).toEqual([]);
  });

  it('a user rule on a parent domain answers its subdomains', () => {
    expect(toAsk([site('docs.google.com', 30 * MIN)], [...defaults, user('domain', 'google.com', 'productive')])).toEqual([]);
  });

  it('skips short use, private browsing, ignored apps and pages no rule can change', () => {
    const rows = toAsk(
      [
        app('random.exe', 'Random', 2 * MIN),
        site(null, 30 * MIN, { isPrivate: true }),
        app('spyder.exe', 'Spyder', 30 * MIN),
        site(null, 30 * MIN),
      ],
      defaults,
    );
    expect(rows).toEqual([]);
  });

  it('groups rows by key and adds up their time', () => {
    const rows = toAsk([app('random.exe', 'Random', 2 * MIN), app('random.exe', 'Random', 2 * MIN)], defaults);
    expect(rows.map((r) => [r.key, r.sec])).toEqual([['Random', 240]]);
  });

  it('unmatched Firefox pages are asked by title', () => {
    const rows = toAsk([{ exe: 'firefox.exe', appName: 'Firefox', domain: null, title: 'Some page', browser: 'firefox', isPrivate: false, ms: 5 * MIN }], defaults);
    expect(rows.map((r) => [r.key, r.ruleTarget])).toEqual([['Firefox: Some page', { matchType: 'title', pattern: 'some page' }]]);
  });
});
