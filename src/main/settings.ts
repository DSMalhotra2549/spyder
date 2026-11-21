import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Db } from './db/db';

export function loadSettings(db: Db): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      // keep default on corrupt value
    }
  }
  return out as unknown as Settings;
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
