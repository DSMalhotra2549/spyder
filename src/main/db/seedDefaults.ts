// Inserts defaults only into empty tables (plan §6).
import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, DEFAULT_TITLE_PATTERNS } from '../../core/defaults';
import { DEFAULT_SCHEDULE, DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import type { Db } from './db';

const isEmpty = (db: Db, table: string) => !db.get(`SELECT 1 AS x FROM ${table} LIMIT 1`);

/**
 * `firstRun` are defaults that win over DEFAULT_SETTINGS for keys not stored yet (e2e: SPYDER_DEFAULTS).
 */
export function seedDefaults(db: Db, nowMs: number, firstRun: Partial<Settings> = {}): void {
  db.transaction(() => {
    if (isEmpty(db, 'schedule')) {
      for (const r of DEFAULT_SCHEDULE) {
        db.run(
          'INSERT INTO schedule (weekday, enabled, start_min, end_min) VALUES (?, ?, ?, ?)',
          r.weekday,
          r.enabled ? 1 : 0,
          r.startMin,
          r.endMin,
        );
      }
    }
    // P82: an install that already has Track from startup saved off keeps the bar on the workday %.
    const stored = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'trackFromStartup'");
    if (stored?.value === 'false') {
      db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('barPercent', ?)", JSON.stringify('day'));
    }
    // Settings are per-key so new keys added in later versions get their defaults too.
    for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...firstRun })) {
      db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    }
    if (isEmpty(db, 'rules')) {
      for (const r of DEFAULT_RULES) {
        db.run(
          'INSERT INTO rules (id, match_type, pattern, category, is_default, created_ms) VALUES (?, ?, ?, ?, 1, ?)',
          randomUUID(),
          r.matchType,
          r.pattern,
          r.category,
          nowMs,
        );
      }
    }
    if (isEmpty(db, 'title_patterns')) {
      for (const p of DEFAULT_TITLE_PATTERNS) {
        db.run(
          'INSERT INTO title_patterns (id, match, pattern, domain, is_default) VALUES (?, ?, ?, ?, 1)',
          randomUUID(),
          p.match,
          p.pattern,
          p.domain,
        );
      }
    }
  });
}
