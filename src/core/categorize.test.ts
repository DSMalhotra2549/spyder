import { describe, expect, it } from 'vitest';
import { categorize, type ActivityKey, type Rule } from './categorize';
import { DEFAULT_RULES } from './defaults';

const defaults: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
const app = (exe: string): ActivityKey => ({ exe, domain: null, title: null, browser: null });
const site = (domain: string | null, title: string | null = null): ActivityKey => ({
  exe: 'chrome.exe',
  domain,
  title,
  browser: 'chrome',
});

describe('categorize (§9.4)', () => {
  it('app, domain and suffix rules', () => {
    expect(categorize(app('Code.exe'), defaults)).toBe('productive');
    expect(categorize(app('steam.exe'), defaults)).toBe('distracting');
    expect(categorize(app('random.exe'), defaults)).toBe('uncategorized');
    expect(categorize(site('youtube.com'), defaults)).toBe('distracting');
    expect(categorize(site('m.youtube.com'), defaults)).toBe('distracting');
    expect(categorize(site('notyoutube.com'), defaults)).toBe('uncategorized');
    expect(categorize(site(null), defaults)).toBe('neutral');
  });

  it('user rules beat defaults; title beats domain', () => {
    const user: Rule = { matchType: 'domain', pattern: 'youtube.com', category: 'productive', isDefault: false };
    expect(categorize(site('youtube.com'), [...defaults, user])).toBe('productive');
    const title: Rule = { matchType: 'title', pattern: 'tutorial', category: 'productive', isDefault: false };
    expect(categorize(site('youtube.com', 'React Tutorial - YouTube'), [...defaults, title])).toBe('productive');
  });

  it('longest pattern wins within a type', () => {
    const rules: Rule[] = [
      { matchType: 'domain', pattern: 'google.com', category: 'neutral', isDefault: true },
      { matchType: 'domain', pattern: 'docs.google.com', category: 'productive', isDefault: true },
    ];
    expect(categorize(site('docs.google.com'), rules)).toBe('productive');
  });
});
