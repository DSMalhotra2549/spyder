// SQL for the engine host and data IPC. All rows use epoch ms (plan §3).
import { randomUUID } from 'node:crypto';
import type { Rule } from '../../core/categorize';
import type { ActivityRow } from '../../core/merge';
import type { DayOverride } from '../../core/schedule';
import type { TitlePattern } from '../../core/titlePatterns';
import type { ScheduleRow } from '../../core/settings';
import type { Effect, EngineState, Heartbeat } from '../../core/types';
import type { Db, SqlValue } from './db';

type DbEffect = Extract<Effect, { db: string }>;

const n = (v: unknown): SqlValue => (v === undefined ? null : (v as SqlValue));

/** Applies engine DB effects in order, in one transaction. */
export function applyDbEffects(db: Db, effects: DbEffect[]): void {
  if (!effects.length) return;
  db.transaction(() => {
    for (const e of effects) applyOne(db, e);
  });
}

const SESSION_COLS = {
  name: 'name',
  projectId: 'project_id',
  plannedSec: 'planned_sec',
  status: 'status',
  endedMs: 'ended_ms',
  elapsedSec: 'elapsed_sec',
  overtimeSec: 'overtime_sec',
  endReason: 'end_reason',
};

function applyOne(db: Db, e: DbEffect): void {
  switch (e.db) {
    case 'insertSession': {
      const r = e.row;
      db.run(
        `INSERT INTO sessions (id, kind, name, project_id, planned_sec, direction, status, started_ms, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id, r.kind, r.name, r.projectId, r.plannedSec, r.direction, r.status, r.startedMs, r.createdMs,
      );
      return;
    }
    case 'updateSession': {
      const r = e.row as unknown as Record<string, unknown> & { id: string };
      const set = Object.entries(SESSION_COLS).filter(([k]) => k in r);
      if (!set.length) return;
      db.run(
        `UPDATE sessions SET ${set.map(([, c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
        ...set.map(([k]) => n(r[k])),
        r.id,
      );
      return;
    }
    case 'openSegment':
      db.run(
        'INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, NULL, ?)',
        e.row.id, e.row.sessionId, e.row.startMs, e.row.source,
      );
      return;
    case 'closeSegment':
      db.run('UPDATE segments SET end_ms = ? WHERE id = ?', e.row.endMs, e.row.id);
      return;
    case 'insertSegment':
      db.run(
        'INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, ?)',
        e.row.id, e.row.sessionId, e.row.startMs, e.row.endMs, e.row.source,
      );
      // Keep elapsed_sec = Σ closed segments (also for sessions no longer in engine state).
      db.run(
        `UPDATE sessions SET elapsed_sec = (SELECT COALESCE(ROUND(SUM(end_ms - start_ms) / 1000.0), 0)
           FROM segments WHERE session_id = ? AND end_ms IS NOT NULL) WHERE id = ?`,
        e.row.sessionId, e.row.sessionId,
      );
      return;
    case 'insertAway': {
      const r = e.row;
      db.run(
        'INSERT INTO away_periods (id, start_ms, end_ms, reason, interrupted_session_id) VALUES (?, ?, ?, ?, ?)',
        r.id, r.startMs, r.endMs, r.reason, r.interruptedSessionId,
      );
      return;
    }
    case 'updateAway': {
      const r = e.row;
      db.run(
        'UPDATE away_periods SET classification = ?, label = ?, classified_ms = ? WHERE id = ?',
        r.classification, r.label, r.classifiedMs, r.id,
      );
      return;
    }
  }
}

// ---- heartbeat ---------------------------------------------------------------
export function loadHeartbeat(db: Db): Heartbeat | null {
  const r = db.get<{ ts_ms: number; engine_state: string }>('SELECT ts_ms, engine_state FROM heartbeat WHERE id = 1');
  if (!r) return null;
  try {
    return { tsMs: r.ts_ms, state: JSON.parse(r.engine_state) as EngineState };
  } catch {
    return null;
  }
}

export function saveHeartbeat(db: Db, tsMs: number, state: EngineState): void {
  db.run(
    `INSERT INTO heartbeat (id, ts_ms, engine_state) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts_ms = excluded.ts_ms, engine_state = excluded.engine_state`,
    tsMs,
    JSON.stringify(state),
  );
}

// ---- schedule ----------------------------------------------------------------
export function loadSchedule(db: Db): ScheduleRow[] {
  return db
    .all<{ weekday: number; enabled: number; start_min: number; end_min: number }>('SELECT * FROM schedule')
    .map((r) => ({ weekday: r.weekday, enabled: !!r.enabled, startMin: r.start_min, endMin: r.end_min }));
}

export function loadOverrides(db: Db): Map<string, DayOverride> {
  const rows = db.all<{ date: string; enabled: number; start_min: number; end_min: number }>(
    'SELECT * FROM day_overrides',
  );
  return new Map(
    rows.map((r) => [r.date, { date: r.date, enabled: !!r.enabled, startMin: r.start_min, endMin: r.end_min }]),
  );
}

export function upsertOverride(db: Db, o: DayOverride): void {
  db.run(
    `INSERT INTO day_overrides (date, enabled, start_min, end_min) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET enabled = excluded.enabled, start_min = excluded.start_min, end_min = excluded.end_min`,
    o.date, o.enabled ? 1 : 0, o.startMin, o.endMin,
  );
}

// ---- sessions & projects -------------------------------------------------------
export function sessionRow(db: Db, id: string): { name: string | null; elapsed_sec: number; planned_sec: number | null } | undefined {
  return db.get('SELECT name, elapsed_sec, planned_sec FROM sessions WHERE id = ?', id);
}

/** Σ non-break segment time inside [dayStart, now] (open segments count up to now). */
export function workSecBetween(db: Db, fromMs: number, toMs: number): number {
  const r = db.get<{ s: number | null }>(
    `SELECT SUM(MAX(0, MIN(COALESCE(g.end_ms, ?), ?) - MAX(g.start_ms, ?))) / 1000.0 AS s
       FROM segments g JOIN sessions s ON s.id = g.session_id
      WHERE s.kind != 'break' AND g.start_ms < ? AND COALESCE(g.end_ms, ?) > ?`,
    toMs, toMs, fromMs, toMs, toMs, fromMs,
  );
  return r?.s ?? 0;
}

export function nameSuggestions(db: Db, prefix: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT name FROM sessions WHERE name IS NOT NULL AND name LIKE ? ESCAPE '\\' AND kind != 'break'
       GROUP BY name COLLATE NOCASE ORDER BY MAX(started_ms) DESC LIMIT 8`,
      `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    )
    .map((r) => r.name);
}

export interface ProjectRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

export function listProjects(db: Db): ProjectRow[] {
  return db
    .all<{ id: string; name: string; color: string; archived: number }>(
      'SELECT id, name, color, archived FROM projects ORDER BY name COLLATE NOCASE',
    )
    .map((r) => ({ ...r, archived: !!r.archived }));
}

export function saveProject(
  db: Db,
  p: { id?: string; name: string; color?: string; archived?: boolean },
  nowMs: number,
): ProjectRow {
  const id = p.id ?? randomUUID();
  db.run(
    `INSERT INTO projects (id, name, color, archived, created_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, archived = excluded.archived`,
    id, p.name.trim(), p.color ?? '#7B61FF', p.archived ? 1 : 0, nowMs,
  );
  return listProjects(db).find((r) => r.id === id)!;
}

// ---- rules & flags -----------------------------------------------------------
export function loadRules(db: Db): Rule[] {
  return db
    .all<{ match_type: Rule['matchType']; pattern: string; category: Rule['category']; is_default: number }>(
      'SELECT match_type, pattern, category, is_default FROM rules',
    )
    .map((r) => ({ matchType: r.match_type, pattern: r.pattern, category: r.category, isDefault: !!r.is_default }));
}

export function insertFlag(
  db: Db,
  f: { tsMs: number; sessionId: string | null; target: string; continuousSec: number },
): void {
  db.run(
    'INSERT INTO distraction_flags (id, ts_ms, session_id, target, continuous_sec) VALUES (?, ?, ?, ?, ?)',
    randomUUID(), f.tsMs, f.sessionId, f.target, f.continuousSec,
  );
}

// ---- activity capture (plan §9) ----------------------------------------------------
export function insertActivity(db: Db, rows: ActivityRow[]): void {
  if (!rows.length) return;
  db.transaction(() => {
    for (const r of rows) {
      db.run(
        'INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        r.startMs, r.endMs, r.exe, r.appName, r.title, r.domain, r.browser, r.isPrivate ? 1 : 0,
      );
    }
  });
}

export function loadTitlePatterns(db: Db): TitlePattern[] {
  return db.all<TitlePattern>('SELECT match, pattern, domain FROM title_patterns');
}
