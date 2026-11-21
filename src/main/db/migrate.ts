import type { Db } from './db';

export interface Migration {
  version: number;
  sql: string;
}

/** Applies migrations whose version isn't in schema_migrations yet. Returns the versions applied. */
export function migrate(db: Db, migrations: Migration[], nowMs: number): number[] {
  const hasTable = db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  const done = new Set(
    hasTable ? db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version) : [],
  );
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, applied_ms) VALUES (?, ?)', m.version, nowMs);
    });
    applied.push(m.version);
  }
  return applied;
}
