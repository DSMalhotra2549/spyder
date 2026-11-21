// Omnibox value → domain (plan §9.2).

/** Host of an omnibox value, lowercase, without a leading `www.`. null if it can't be parsed. */
export function domainOf(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(v)) return 'browser-internal';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    if (!host) return null;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export interface OmniboxMemo {
  hwnd: number;
  title: string | null;
  domain: string | null;
}

/**
 * Domain for one omnibox read. While the user is typing (empty value or one with a space),
 * the last domain for that window is reused as long as the title hasn't changed.
 */
export function resolveDomain(
  value: string,
  hwnd: number,
  title: string | null,
  memo: OmniboxMemo | null,
): { domain: string | null; memo: OmniboxMemo } {
  const v = value.trim();
  if (!v || /\s/.test(v)) {
    const domain = memo && memo.hwnd === hwnd && memo.title === title ? memo.domain : null;
    return { domain, memo: { hwnd, title, domain } };
  }
  const domain = domainOf(v);
  return { domain, memo: { hwnd, title, domain } };
}
