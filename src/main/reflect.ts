// P98: the midnight card. After a day ends, the prompt asks for its wins and how I'll improve, once per day.
import { randomUUID } from 'node:crypto';
import { dateKey, startOfDay } from '../core/schedule';
import type { Db } from './db/db';

export interface ReflectDay {
  date: string;
  wins: string[];
  improves: string[];
}

/**
 * The last day before today with blocks (the last day Spyder tracked), unless it was already saved or skipped, or its
 * review already has both a win and an improvement.
 */
export function reflectDay(db: Db, nowMs: number): ReflectDay | null {
  const last = db.get<{ s: number | null }>('SELECT MAX(started_ms) AS s FROM sessions WHERE deleted_ms IS NULL AND started_ms < ?', startOfDay(nowMs));
  if (last?.s == null) return null;
  const date = dateKey(last.s);
  if (db.get('SELECT 1 AS x FROM reflections WHERE date = ?', date)) return null;
  const items = db.all<{ kind: string; text: string }>('SELECT kind, text FROM review_items WHERE date = ? ORDER BY sort, created_ms', date);
  const wins = items.filter((i) => i.kind === 'win').map((i) => i.text);
  const improves = items.filter((i) => i.kind === 'improve').map((i) => i.text);
  if (wins.length && improves.length) return null;
  return { date, wins, improves };
}

/** Saves the card: the lists replace the day's wins and improvements; null (Skip for today) leaves them. Either way the day is done. */
export function saveReflection(db: Db, date: string, lists: { win: string[]; improve: string[] } | null, nowMs: number): void {
  db.transaction(() => {
    if (lists) {
      for (const kind of ['win', 'improve'] as const) {
        db.run('DELETE FROM review_items WHERE date = ? AND kind = ?', date, kind);
        lists[kind].forEach((text, sort) =>
          db.run('INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), date, kind, text, sort, nowMs),
        );
      }
    }
    db.run('INSERT INTO reflections (date, done_ms) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET done_ms = excluded.done_ms', date, nowMs);
  });
}

export function reflectedMs(db: Db, date: string): number | null {
  return db.get<{ done_ms: number }>('SELECT done_ms FROM reflections WHERE date = ?', date)?.done_ms ?? null;
}
