// Firefox window title → page title + domain (plan §9.3, ADR-0007).
import type { PatternMatch } from './defaults';

export interface TitlePattern {
  match: PatternMatch;
  pattern: string;
  domain: string;
}

export interface FirefoxPage {
  title: string | null;
  domain: string | null;
  isPrivate: boolean;
}

const SUFFIX = /^(.*?)\s[—–-]\s(?:Mozilla\s)?Firefox(\sPrivate Browsing)?$/;

export function matchTitle(page: string, patterns: TitlePattern[]): string | null {
  const t = page.toLowerCase();
  const sorted = [...patterns].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const p of sorted) {
    const pat = p.pattern.toLowerCase();
    const hit =
      p.match === 'suffix' ? t.endsWith(pat) : p.match === 'prefix' ? t.startsWith(pat) : t.includes(pat);
    if (hit) return p.domain;
  }
  return null;
}

export function parseFirefoxTitle(windowTitle: string, patterns: TitlePattern[]): FirefoxPage {
  const raw = windowTitle.trim();
  const m = SUFFIX.exec(raw);
  if (m?.[2] || /^(Mozilla\s)?Firefox Private Browsing$/i.test(raw)) return { title: null, domain: null, isPrivate: true };
  if (!m) {
    // "Mozilla Firefox" alone is a new tab.
    if (/^(Mozilla\s)?Firefox$/i.test(raw)) return { title: null, domain: null, isPrivate: false };
    return { title: raw || null, domain: raw ? matchTitle(raw, patterns) : null, isPrivate: false };
  }
  const page = m[1].trim();
  return { title: page || null, domain: page ? matchTitle(page, patterns) : null, isPrivate: false };
}
