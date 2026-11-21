// Prints row counts per table plus the last 20 rows of the core tables.
// Usage: npm run db:dump   (DB from SPYDER_DATA_DIR or %APPDATA%\Spyder)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from '../src/main/db/db.ts';

const dir = process.env.SPYDER_DATA_DIR ?? join(process.env.APPDATA ?? '', 'Spyder');
const file = join(dir, 'spyder.db');
if (!existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}
const db = new Db(file);
console.log(`Database: ${file}\n`);

const tables = db
  .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map((r) => r.name);
console.table(
  Object.fromEntries(tables.map((t) => [t, db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n])),
);

const fmt = (ms: unknown) => (typeof ms === 'number' && ms > 1e12 ? new Date(ms).toLocaleString() : ms);
const recent: Record<string, string> = {
  sessions: 'started_ms',
  segments: 'start_ms',
  away_periods: 'start_ms',
  activity: 'start_ms',
};
for (const [t, col] of Object.entries(recent)) {
  const rows = db.all(`SELECT * FROM ${t} ORDER BY ${col} DESC LIMIT 20`).reverse();
  console.log(`\n${t} (last ${rows.length})`);
  if (rows.length) {
    console.table(
      rows.map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k.endsWith('_ms') ? fmt(v) : v])),
      ),
    );
  }
}
db.close();
