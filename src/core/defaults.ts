// Default categorization rules (§9.4) and Firefox title patterns (§9.3).
export type Category = 'productive' | 'neutral' | 'distracting';
export type MatchType = 'app' | 'domain' | 'title';
export type PatternMatch = 'suffix' | 'prefix' | 'contains';

export interface DefaultRule {
  matchType: MatchType;
  pattern: string;
  category: Category;
}
export interface DefaultTitlePattern {
  match: PatternMatch;
  pattern: string;
  domain: string;
}

const list = (matchType: MatchType, category: Category, s: string): DefaultRule[] =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((pattern) => ({ matchType, pattern, category }));

export const DEFAULT_RULES: DefaultRule[] = [
  ...list(
    'app',
    'productive',
    'code.exe cursor.exe devenv.exe idea64.exe pycharm64.exe webstorm64.exe windowsterminal.exe powershell.exe pwsh.exe cmd.exe winword.exe excel.exe powerpnt.exe onenote.exe notion.exe obsidian.exe figma.exe notepad.exe notepad++.exe',
  ),
  ...list(
    'app',
    'neutral',
    'outlook.exe olk.exe ms-teams.exe teams.exe zoom.exe slack.exe explorer.exe chrome.exe firefox.exe msedge.exe spotify.exe discord.exe whatsapp.exe applicationframehost.exe',
  ),
  ...list('app', 'distracting', 'steam.exe epicgameslauncher.exe battle.net.exe'),
  ...list(
    'domain',
    'productive',
    'github.com gitlab.com stackoverflow.com docs.google.com notion.so figma.com developer.mozilla.org learn.microsoft.com vercel.com linear.app atlassian.net trello.com',
  ),
  ...list(
    'domain',
    'neutral',
    'mail.google.com outlook.office.com outlook.live.com calendar.google.com meet.google.com zoom.us slack.com teams.microsoft.com google.com bing.com wikipedia.org linkedin.com chatgpt.com claude.ai browser-internal web.whatsapp.com',
  ),
  ...list(
    'domain',
    'distracting',
    'youtube.com netflix.com primevideo.com hotstar.com twitch.tv reddit.com x.com twitter.com facebook.com instagram.com tiktok.com 9gag.com',
  ),
];

const tp = (match: PatternMatch, pattern: string, domain: string): DefaultTitlePattern => ({
  match,
  pattern,
  domain,
});

export const DEFAULT_TITLE_PATTERNS: DefaultTitlePattern[] = [
  tp('suffix', '- YouTube', 'youtube.com'),
  tp('suffix', '- Gmail', 'mail.google.com'),
  tp('suffix', '- Google Docs', 'docs.google.com'),
  tp('suffix', '- Google Sheets', 'docs.google.com'),
  tp('suffix', '- Google Slides', 'docs.google.com'),
  tp('suffix', '- Google Search', 'google.com'),
  tp('suffix', '- Google Calendar', 'calendar.google.com'),
  tp('suffix', '- Stack Overflow', 'stackoverflow.com'),
  tp('suffix', '- Wikipedia', 'wikipedia.org'),
  tp('suffix', '- Reddit', 'reddit.com'),
  tp('suffix', '/ X', 'x.com'),
  tp('suffix', '- Twitch', 'twitch.tv'),
  tp('suffix', '| TikTok', 'tiktok.com'),
  tp('suffix', '| Facebook', 'facebook.com'),
  tp('suffix', '| LinkedIn', 'linkedin.com'),
  tp('suffix', '- Outlook', 'outlook.office.com'),
  tp('suffix', '- Claude', 'claude.ai'),
  tp('suffix', '| Netflix', 'netflix.com'),
  tp('prefix', 'GitHub - ', 'github.com'),
  tp('prefix', 'Netflix', 'netflix.com'),
  tp('contains', '· GitHub', 'github.com'),
  tp('contains', ': r/', 'reddit.com'),
  tp('contains', 'Instagram', 'instagram.com'),
  tp('contains', 'ChatGPT', 'chatgpt.com'),
  tp('contains', 'WhatsApp', 'web.whatsapp.com'),
];
