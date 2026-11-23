import { describe, expect, it } from 'vitest';
import { categorize, type Rule } from './categorize';
import { DEFAULT_RULES, DEFAULT_TITLE_PATTERNS } from './defaults';
import { flushMerge, initialMerge, mergeSample, type ActivityRow, type ActivitySampleRow } from './merge';
import { parseFirefoxTitle } from './titlePatterns';
import { domainOf, resolveDomain } from './url';

describe('domainOf', () => {
  it.each([
    ['https://example.com/a?b=1', 'example.com'],
    ['example.com/path', 'example.com'],
    ['www.youtube.com/watch?v=x', 'youtube.com'],
    ['https://WWW.GitHub.com', 'github.com'],
    ['m.youtube.com', 'm.youtube.com'],
    ['http://localhost:5173/', 'localhost'],
    ['chrome://settings', 'browser-internal'],
    ['edge://newtab', 'browser-internal'],
    ['', null],
    ['   ', null],
    ['how to bake bread', null],
  ])('%s → %s', (raw, want) => expect(domainOf(raw)).toBe(want));
});

describe('resolveDomain', () => {
  it('reuses the last domain while typing in the same window with the same title', () => {
    const a = resolveDomain('github.com/x', 1, 'Repo', null);
    expect(a.domain).toBe('github.com');
    expect(resolveDomain('how to', 1, 'Repo', a.memo).domain).toBe('github.com');
    expect(resolveDomain('', 1, 'Repo', a.memo).domain).toBe('github.com');
  });
  it('drops it when the title or window changes', () => {
    const a = resolveDomain('github.com', 1, 'Repo', null);
    expect(resolveDomain('how to', 1, 'Other', a.memo).domain).toBeNull();
    expect(resolveDomain('how to', 2, 'Repo', a.memo).domain).toBeNull();
    expect(resolveDomain('how to', 1, 'Repo', null).domain).toBeNull();
  });
});

describe('parseFirefoxTitle', () => {
  const P = DEFAULT_TITLE_PATTERNS;
  it.each([
    ['Lofi beats - YouTube — Mozilla Firefox', 'Lofi beats - YouTube', 'youtube.com'],
    ['(2) YouTube — Mozilla Firefox', '(2) YouTube', 'youtube.com'],
    ['YouTube — Mozilla Firefox', 'YouTube', 'youtube.com'],
    ['Inbox (3) - me@x.com - Gmail — Mozilla Firefox', 'Inbox (3) - me@x.com - Gmail', 'mail.google.com'],
    ['GitHub - owner/repo: desc — Mozilla Firefox', 'GitHub - owner/repo: desc', 'github.com'],
    ['Pull requests · owner/repo · GitHub — Mozilla Firefox', 'Pull requests · owner/repo · GitHub', 'github.com'],
    ['Cool post : r/programming — Mozilla Firefox', 'Cool post : r/programming', 'reddit.com'],
    ['Someone on X: "hi" / X — Mozilla Firefox', 'Someone on X: "hi" / X', 'x.com'],
    ['Some blog post — Mozilla Firefox', 'Some blog post', null],
    ['Some blog post - Firefox', 'Some blog post', null],
    ['168 Hours of Decisions - YouTube — Zen Browser', '168 Hours of Decisions - YouTube', 'youtube.com'],
    ['028 - Google Docs — Zen Browser', '028 - Google Docs', 'docs.google.com'],
    ['GetHookd AI — Zen Browser', 'GetHookd AI', null],
  ])('%s', (t, title, domain) => {
    expect(parseFirefoxTitle(t, P)).toEqual({ title, domain, isPrivate: false });
  });
  it('private window → no title, no domain', () => {
    expect(parseFirefoxTitle('Secret - YouTube — Mozilla Firefox Private Browsing', P)).toEqual({
      title: null,
      domain: null,
      isPrivate: true,
    });
    expect(parseFirefoxTitle('Mozilla Firefox Private Browsing', P).isPrivate).toBe(true);
    expect(parseFirefoxTitle('Secret - YouTube — Zen Browser Private Browsing', P).isPrivate).toBe(true);
  });
  it('bare "Mozilla Firefox" is a new tab', () => {
    expect(parseFirefoxTitle('Mozilla Firefox', P)).toEqual({ title: null, domain: null, isPrivate: false });
    expect(parseFirefoxTitle('Zen Browser', P)).toEqual({ title: null, domain: null, isPrivate: false });
  });
  it('longest pattern wins', () => {
    const pats = [
      { match: 'contains' as const, pattern: 'Docs', domain: 'a.com' },
      { match: 'suffix' as const, pattern: '- Google Docs', domain: 'docs.google.com' },
    ];
    expect(parseFirefoxTitle('Plan - Google Docs — Mozilla Firefox', pats).domain).toBe('docs.google.com');
  });
});

describe('categorize (defaults)', () => {
  const rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
  it('subdomain matches its parent rule', () => {
    expect(categorize({ exe: 'chrome.exe', domain: 'm.youtube.com', title: null, browser: 'chrome' }, rules)).toBe('distracting');
  });
  it('title > domain > app, user beats default', () => {
    const r: Rule[] = [
      ...rules,
      { matchType: 'title', pattern: 'lecture', category: 'productive', isDefault: false },
      { matchType: 'domain', pattern: 'reddit.com', category: 'neutral', isDefault: false },
    ];
    expect(categorize({ exe: 'chrome.exe', domain: 'youtube.com', title: 'MIT Lecture 3', browser: 'chrome' }, r)).toBe('productive');
    expect(categorize({ exe: 'chrome.exe', domain: 'reddit.com', title: 'x', browser: 'chrome' }, r)).toBe('neutral');
    expect(categorize({ exe: 'notepad.exe', domain: null, title: 'a.txt', browser: null }, r)).toBe('productive');
  });
});

describe('merge', () => {
  const I = 2000;
  const s = (over: Partial<ActivitySampleRow> = {}): ActivitySampleRow => ({
    exe: 'code.exe',
    appName: 'VS Code',
    title: 'a.ts',
    domain: null,
    browser: null,
    isPrivate: false,
    ...over,
  });
  const run = (samples: [number, ActivitySampleRow][], flushAt?: number) => {
    let st = initialMerge();
    const out: ActivityRow[] = [];
    for (const [t, x] of samples) {
      const r = mergeSample(st, x, t, I);
      st = r.state;
      if (r.closed) out.push(r.closed);
    }
    if (flushAt !== undefined) {
      const r = flushMerge(st, flushAt, I);
      if (r.closed) out.push(r.closed);
    }
    return out;
  };

  it('same key extends one row; flush ends it one interval after the last sample', () => {
    const rows = run([[0, s()], [2000, s()], [4000, s()], [6000, s()]], 100_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startMs: 0, endMs: 8000, exe: 'code.exe' });
  });
  it('flush never goes past the cap (last input)', () => {
    expect(run([[0, s()], [2000, s()], [4000, s()]], 5000)[0].endMs).toBe(5000);
  });
  it('a gap over 2×interval+1 s splits', () => {
    const rows = run([[0, s()], [2000, s()], [7001, s()]], 9001);
    expect(rows.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 4000],
      [7001, 9001],
    ]);
    // Exactly 2×interval+1 s still extends.
    expect(run([[0, s()], [5000, s()]], 7000)).toHaveLength(1);
  });
  it('a title change splits at the new sample', () => {
    const rows = run([[0, s()], [2000, s()], [3000, s({ title: 'b.ts' })]], 5000);
    expect(rows.map((r) => [r.title, r.startMs, r.endMs])).toEqual([
      ['a.ts', 0, 3000],
      ['b.ts', 3000, 5000],
    ]);
  });
  it('rows under 1 s are dropped', () => {
    const rows = run([[0, s()], [500, s({ exe: 'chrome.exe' })], [2500, s()]], 2500);
    expect(rows.map((r) => r.exe)).toEqual(['chrome.exe']);
  });
  it('domain and private flag are part of the key', () => {
    const b = s({ exe: 'chrome.exe', browser: 'chrome', title: 't' });
    expect(run([[0, { ...b, domain: 'a.com' }], [2000, { ...b, domain: 'b.com' }]], 4000)).toHaveLength(2);
    expect(run([[0, b], [2000, { ...b, isPrivate: true }]], 4000)).toHaveLength(2);
  });
});
