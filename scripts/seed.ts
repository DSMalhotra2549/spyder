// Seeds realistic days for reports (Phase 5): planned, timed and open sessions, breaks, one away
// period of each classification, Chrome and Firefox activity including YouTube, an overtime, a
// distraction flag, and wins / improvements / KPI values. Deterministic per date.
// Usage: SPYDER_DATA_DIR=<dir> npx tsx scripts/seed.ts [--days N=7] [--to YYYY-MM-DD=today]
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DayActivity } from '../src/core/aggregate.ts';
import { addDays, dateKey, dayStartFromKey, workWindow } from '../src/core/schedule.ts';
import type { AwayClassification, AwayReason, Kind } from '../src/core/types.ts';
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
const now = Date.now();
const projects = {
  spyder: repo.saveProject(db, { name: 'Spyder', color: '#7B61FF' }, now).id,
  client: repo.saveProject(db, { name: 'Client A', color: '#22D3EE' }, now).id,
};
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
let sessionsN = 0;
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
  const session = (
    kind: Kind,
    name: string | null,
    durMin: number,
    o: { planned?: number; direction?: 'up' | 'down'; project?: string; pool?: App[]; distract?: boolean; last?: boolean } = {},
  ) => {
    if (t >= win.endMs) return null;
    const id = randomUUID();
    const s = t;
    const e = o.last ? win.endMs : Math.min(win.endMs, t + durMin * M);
    const elapsed = Math.round((e - s) / 1000);
    const planned = o.planned !== undefined ? o.planned * 60 : null;
    db.run(
      `INSERT INTO sessions (id, kind, name, project_id, planned_sec, direction, status, started_ms, ended_ms, elapsed_sec,
         overtime_sec, end_reason, created_ms) VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?)`,
      id, kind, name, o.project ?? null, planned, kind === 'planned' ? (o.direction ?? 'down') : null, s, e, elapsed,
      planned !== null ? Math.max(0, elapsed - planned) : 0, e >= win.endMs ? 'work_hours_end' : 'done', s,
    );
    db.run('INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, ?)', randomUUID(), id, s, e, 'live');
    sessionsN++;
    if (o.distract && e - s > 30 * M) {
      // A YouTube detour in the middle: long enough for one nudge (5 min) and a flag.
      const ds = s + 15 * M;
      const de = ds + int(6, 9) * M;
      fill(s, ds, o.pool ?? [A.code]);
      act(ds, de, A.ytChrome);
      db.run(
        'INSERT INTO distraction_flags (id, ts_ms, session_id, target, continuous_sec) VALUES (?, ?, ?, ?, 300)',
        randomUUID(), ds + 5 * M, id, 'youtube.com',
      );
      fill(de, e, o.pool ?? [A.code]);
    } else fill(s, e, o.pool ?? [A.code]);
    t = e;
    return id;
  };
  const away = (durMin: number, reason: AwayReason, c: AwayClassification, label: string | null = null, interrupted: string | null = null) => {
    if (t >= win.endMs) return;
    const e = Math.min(win.endMs, t + durMin * M);
    db.run(
      'INSERT INTO away_periods (id, start_ms, end_ms, reason, classification, label, interrupted_session_id, classified_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      randomUUID(), t, e, reason, c, label, interrupted, e + M,
    );
    if (c === 'working' && interrupted) segment(interrupted, t, e, 'away_working');
    t = e;
  };
  /** Another segment of an existing session (it resumed after an away period). */
  const segment = (id: string, s: number, e: number, source: 'live' | 'away_working') => {
    db.run('INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, ?)', randomUUID(), id, s, e, source);
    db.run('UPDATE sessions SET elapsed_sec = elapsed_sec + ?, ended_ms = ? WHERE id = ?', Math.round((e - s) / 1000), e, id);
  };
  const resume = (id: string | null, durMin: number, pool: App[]) => {
    if (!id || t >= win.endMs) return;
    const e = Math.min(win.endMs, t + durMin * M);
    segment(id, t, e, 'live');
    fill(t, e, pool);
    t = e;
  };

  const work = [A.code, A.code, A.github, A.so, A.blog, A.slack, A.hn];
  session('planned', 'Replying to emails', 30 + (isLast ? 8 : int(0, 12)), { planned: 30, pool: [A.outlook, A.gmail, A.slack] });
  session('timed', 'Inbox zero', 15, { planned: 15, pool: [A.outlook, A.gmail] });
  session('open', 'Spyder dashboard', int(60, 80), { project: projects.spyder, pool: work, distract: true });
  session('break', 'Lunch', int(40, 50), { planned: 45, pool: [A.ytFirefox, A.whatsapp] });
  away(int(20, 30), 'lock', 'meeting', 'Standup');
  const review = session('open', 'Code review', int(40, 55), { project: projects.client, pool: [A.github, A.code, A.slack] });
  away(10, 'idle', 'working', null, review);
  resume(review, 20, [A.github, A.code]);
  away(10, 'idle', 'break');
  session('planned', 'Write weekly report', int(40, 55), { planned: 45, direction: 'up', pool: [A.word, A.notion, A.blog] });
  away(15, 'lock', 'offline_work', 'Whiteboard sketch');
  session('open', 'Planning', 30, { project: projects.spyder, pool: [A.notion, A.code] });
  away(10, 'idle', 'not_working');
  session('open', 'Wrap-up', 0, { pool: work, last: true });

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
console.log(`Seeded ${days} day(s) ${dateKey(first)} → ${to} into ${dir}: ${sessionsN} sessions, ${activityN} activity rows`);
db.close();
