// P102: the real icon of each app in Apps & sites, read from its program file by Windows (no network).
import { app } from 'electron';
import type { Db } from './db/db';

const known = new Map<string, string>(); // exe → path already written this run
const icons = new Map<string, string | null>(); // exe → data URL, null when it has none

/** Remember where an exe lives; writes only when it's new or moved. */
export function rememberAppPath(db: Db, exe: string, path: string): void {
  if (known.get(exe) === path) return;
  known.set(exe, path);
  icons.delete(exe);
  db.run('INSERT INTO app_paths (exe, path) VALUES (?, ?) ON CONFLICT(exe) DO UPDATE SET path = excluded.path', exe, path);
}

/** Icons (PNG data URLs) of the exes whose program file is known; the rest are left out. */
export async function appIcons(db: Db, exes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const exe of new Set(exes)) {
    if (!icons.has(exe)) {
      const row = db.get<{ path: string }>('SELECT path FROM app_paths WHERE exe = ?', exe);
      let url: string | null = null;
      if (row) {
        try {
          const img = await app.getFileIcon(row.path, { size: 'normal' });
          url = img.isEmpty() ? null : img.toDataURL();
        } catch {
          url = null; // the file is gone or unreadable
        }
      }
      icons.set(exe, url);
    }
    const url = icons.get(exe);
    if (url) out[exe] = url;
  }
  return out;
}
