import { cleanSettings, DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Db } from './db/db';

/** Stored values go through the same validation as changes, so old or out-of-range values can't reach the app. */
export function loadSettings(db: Db): Settings {
  const out: Record<string, unknown> = {};
  for (const r of db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      // keep default on corrupt value
    }
  }
  return { ...DEFAULT_SETTINGS, ...cleanSettings(out) };
}

export function saveSettings(db: Db, partial: Partial<Settings>): void {
  db.transaction(() => {
    for (const [k, v] of Object.entries(partial)) {
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k,
        JSON.stringify(v),
      );
    }
  });
}
