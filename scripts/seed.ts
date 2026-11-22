// Seeds realistic days of 15-min blocks (ADR-0011): answers (some repeated, one merged 30-min block),
// break blocks, an untracked gap, blocks not accounted for on the last day, Chrome and Firefox activity
// including YouTube, a distraction flag, and wins / improvements / KPI values. Deterministic per date.
// Usage: SPYDER_DATA_DIR=<dir> npx tsx scripts/seed.ts [--days N=7] [--to YYYY-MM-DD=today]
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DayActivity } from '../src/core/aggregate.ts';
import { addDays, dateKey, dayStartFromKey, workWindow } from '../src/core/schedule.ts';
import { Db } from '../src/main/db/db.ts';
import { loadMigrationsFromDisk } from '../src/main/db/loadFromDisk.ts';
import { migrate } from '../src/main/db/migrate.ts';
import * as repo from '../src/main/db/repo.ts';
import { seedDefaults } from '../src/main/db/seedDefaults.ts';
import { summaryFor } from '../src/main/report.ts';
import { loadSettings } from '../src/main/settings.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const days = Number(arg('days') ?? 7);
const to = arg('to') ?? dateKey(Date.now());
const dir = process.env.SPYDER_DATA_DIR ?? join(process.env.APPDATA ?? '', 'Spyder');
mkdirSync(dir, { recursive: true });

const db = new Db(join(dir, 'spyder.db'));
migrate(db, loadMigrationsFromDisk(join(__dirname, '../src/main/db/migrations')), Date.now());
seedDefaults(db, Date.now());

const first = addDays(dayStartFromKey(to), -(days - 1));
const end = addDays(dayStartFromKey(to), 1);
if (db.get('SELECT 1 AS x FROM sessions WHERE started_ms >= ? AND started_ms < ? LIMIT 1', first, end)) {
  console.error(`${dir} already has sessions between ${dateKey(first)} and ${to}; use an empty data dir.`);
  process.exit(1);
}

// ---- deterministic randomness ---------------------------------------------------
function rng(seed: string) {
  let a = [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- fixed data -------------------------------------------------------------------
const kpiId = (name: string, unit: string, sort: number) => {
  const found = db.get<{ id: string }>('SELECT id FROM kpis WHERE name = ?', name);
  if (found) return found.id;
  const id = randomUUID();
  db.run('INSERT INTO kpis (id, name, unit, archived, sort) VALUES (?, ?, ?, 0, ?)', id, name, unit, sort);
  return id;
};
const kpis = { emails: kpiId('Emails answered', 'emails', 0), deep: kpiId('Deep work blocks', 'blocks', 1) };

type App = Omit<DayActivity, 'startMs' | 'endMs' | 'isPrivate'>;
const A: Record<string, App> = {
  code: { exe: 'code.exe', appName: 'Visual Studio Code', title: 'aggregate.ts - spyder - Visual Studio Code', domain: null, browser: null },
  github: { exe: 'chrome.exe', appName: 'Google Chrome', title: 'Pull requests · spyder · GitHub', domain: 'github.com', browser: 'chrome' },
  so: { exe: 'firefox.exe', appName: 'Firefox', title: 'How to sum intervals in SQL - Stack Overflow', domain: 'stackoverflow.com', browser: 'firefox' },
  blog: { exe: 'firefox.exe', appName: 'Firefox', title: 'Some blog post', domain: null, browser: 'firefox' },
  hn: { exe: 'chrome.exe', appName: 'Google Chrome', title: 'Hacker News', domain: 'news.ycombinator.com', browser: 'chrome' },
  outlook: { exe: 'olk.exe', appName: 'Outlook', title: 'Inbox - Outlook', domain: null, browser: null },
  gmail: { exe: 'chrome.exe', appName: 'Google Chrome', title: 'Inbox (3) - Gmail', domain: 'mail.google.com', browser: 'chrome' },
  slack: { exe: 'slack.exe', appName: 'Slack', title: 'general - Slack', domain: null, browser: null },
  notion: { exe: 'notion.exe', appName: 'Notion', title: 'Weekly report', domain: null, browser: null },
  word: { exe: 'winword.exe', appName: 'Microsoft Word', title: 'Report.docx - Word', domain: null, browser: null },
  ytChrome: { exe: 'chrome.exe', appName: 'Google Chrome', title: 'Lofi hip hop radio - YouTube', domain: 'youtube.com', browser: 'chrome' },
  ytFirefox: { exe: 'firefox.exe', appName: 'Firefox', title: 'Pasta in 10 minutes - YouTube', domain: 'youtube.com', browser: 'firefox' },
  whatsapp: { exe: 'whatsapp.exe', appName: 'WhatsApp', title: 'WhatsApp', domain: null, browser: null },
  reddit: { exe: 'chrome.exe', appName: 'Google Chrome', title: 'r/programming', domain: 'reddit.com', browser: 'chrome' },
};

const WINS = ['Shipped the daily report', 'Inbox zero before lunch', 'Fixed the flaky test', 'Wrote the weekly report', 'Paired on the review'];
const IMPROVE = ['Close YouTube before starting', 'Plan tomorrow before 17:00', 'Shorter lunch break', 'Batch email twice a day'];

// ---- one day ----------------------------------------------------------------------
const M = 60_000;
let blocksN = 0;
const BREAK = Symbol('break');
let activityN = 0;

function seedDay(dayMs: number, isLast: boolean): void {
  const key = dateKey(dayMs);
  const r = rng(key);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const win = workWindow(dayMs, repo.loadSchedule(db), repo.loadOverrides(db));

  const act = (s: number, e: number, app: App, isPrivate = false) => {
    if (e - s < 1000) return;
    db.run(
      'INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      s, e, app.exe, app.appName, isPrivate ? null : app.title, isPrivate ? null : app.domain, app.browser, isPrivate ? 1 : 0,
    );
    activityN++;
  };
  /** Fills [s, e) with 3–15 min chunks from the pool. */
  const fill = (s: number, e: number, pool: App[]) => {
    for (let t = s; t < e; ) {
      const n = Math.min(e, t + int(3, 15) * M);
      act(t, n, pick(pool));
      t = n;
    }
  };

  if (!win) {
    // Day off: a little browsing, all off hours.
    const t = dayMs + int(13 * 60, 15 * 60) * M;
    act(t, t + int(15, 30) * M, A.reddit);
    act(t + 40 * M, t + 70 * M, A.ytFirefox);
    return;
  }

  let t = win.startMs;
  /** One block from `t` (ADR-0011): an answer, Break, or null for one not accounted for yet. */
  const block = (answer: string | null | typeof BREAK, durMin: number, o: { pool?: App[]; distract?: boolean } = {}) => {
    if (t >= win.endMs) return null;
    const id = randomUUID();
    const s = t;
    const e = Math.min(win.endMs, t + durMin * M);
    const isBreak = answer === BREAK;
    db.run(
      `INSERT INTO sessions (id, kind, name, status, started_ms, ended_ms, elapsed_sec, end_reason, created_ms)
         VALUES (?, ?, ?, 'done', ?, ?, ?, 'done', ?)`,
      id, isBreak ? 'break' : 'open', isBreak ? 'Break' : answer, s, e, Math.round((e - s) / 1000), s,
    );
    db.run('INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, ?)', randomUUID(), id, s, e, 'live');
    blocksN++;
    if (o.distract) {
      // A YouTube detour: long enough for one nudge (5 min) and a flag.
      const ds = s + 2 * M;
      const de = ds + int(6, 9) * M;
      act(ds, de, A.ytChrome);
      db.run('INSERT INTO distraction_flags (id, ts_ms, session_id, target, continuous_sec) VALUES (?, ?, ?, ?, 300)', randomUUID(), ds + 5 * M, id, 'youtube.com');
      fill(s, ds, o.pool ?? [A.code]);
      fill(de, e, o.pool ?? [A.code]);
    } else fill(s, e, o.pool ?? [A.code]);
    t = e;
    return id;
  };
  const blocks = (answer: string | null | typeof BREAK, n: number, o: { pool?: App[]; distractAt?: number } = {}) => {
    for (let i = 0; i < n; i++) block(answer, 15, { pool: o.pool, distract: o.distractAt === i });
  };

  const work = [A.code, A.code, A.github, A.so, A.blog, A.slack, A.hn];
  blocks('Replying to emails', 2, { pool: [A.outlook, A.gmail, A.slack] });
  blocks('Inbox zero', 1, { pool: [A.outlook, A.gmail] });
  blocks('Spyder dashboard', int(3, 4), { pool: work, distractAt: 2 });
  blocks(BREAK, 3, { pool: [A.ytFirefox, A.whatsapp] });
  block('Standup', 30, { pool: [A.slack] }); // two blocks merged into one (P64)
  blocks('Code review', 3, { pool: [A.github, A.code, A.slack] });
  blocks(BREAK, 1, { pool: [A.whatsapp] });
  blocks('Write weekly report', 3, { pool: [A.word, A.notion, A.blog] });
  t += 15 * M; // a deleted block: untracked
  blocks('Planning', 2, { pool: [A.notion, A.code] });
  while (t < win.endMs - (isLast ? 30 * M : 0)) block('Wrap-up', 15, { pool: work });
  // The last day ends with blocks not accounted for yet.
  if (isLast) blocks(null, 2, { pool: work });

  // Off hours: some browsing after work (excluded from the work-hours %).
  const o = win.endMs + int(20, 40) * M;
  act(o, o + int(10, 20) * M, A.reddit);

  // Review: wins, improvements and KPI values; past days are completed.
  let sort = 0;
  for (const text of [pick(WINS), pick(WINS)].filter((x, i, xs) => xs.indexOf(x) === i)) {
    db.run('INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), key, 'win', text, sort++, win.endMs);
  }
  db.run('INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), key, 'improve', pick(IMPROVE), sort, win.endMs);
  db.run('INSERT OR REPLACE INTO kpi_values (date, kpi_id, value) VALUES (?, ?, ?)', key, kpis.emails, int(8, 30));
  db.run('INSERT OR REPLACE INTO kpi_values (date, kpi_id, value) VALUES (?, ?, ?)', key, kpis.deep, int(1, 4));
  if (!isLast) {
    const s = summaryFor(db, key, end, loadSettings(db));
    db.run(
      `INSERT OR REPLACE INTO reviews (date, completed_ms, productive_sec, work_sec, scheduled_sec, goal_sec, goal_met, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      key, win.endMs + 12 * M, s.productiveSec, s.workSec, s.scheduledSec, s.goalSec, s.goalMet ? 1 : 0, s.score,
    );
  }
}

db.transaction(() => {
  for (let d = first; d < end; d = addDays(d, 1)) seedDay(d, dateKey(d) === to);
});
console.log(`Seeded ${days} day(s) ${dateKey(first)} → ${to} into ${dir}: ${blocksN} blocks, ${activityN} activity rows`);
db.close();
