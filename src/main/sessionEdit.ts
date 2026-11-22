// Editing sessions after the fact (P52–P54): delete, merge and undo. The DB work happens here; the
// engine (E20–E22) keeps the running session's time and the prompt queue in step.
import { randomUUID } from 'node:crypto';
import { elapsedSec } from '../core/sessionEngine';
import { dateKey } from '../core/schedule';
import type { Active, EngineError } from '../core/types';
import type { AppCtx } from './context';
import type { Db, Row } from './db/db';
import type { EngineHost } from './engineHost';
import { refreshReview } from './report';

export type EditResult = { ok: true; undoId: string; message: string } | EngineError;

interface Undo {
  id: string;
  /** Full `sessions` rows as they were before the edit (deleted_ms NULL). */
  sessions: Row[];
  /** Segment → session links before a merge. */
  segments: { id: string; session_id: string }[];
  away: { id: string; interrupted_session_id: string | null }[];
  flags: { id: string; session_id: string | null }[];
  dates: string[];
  /** Deleting the running session: the session as it stood when closed, and the open session that replaced it. */
  live?: { active: Active; freshId: string };
  /** Merging into the running session: closed time it gained. */
  absorbed?: { keepId: string; sec: number };
}

const SESSION_COLUMNS = [
  'kind', 'name', 'project_id', 'planned_sec', 'direction', 'status', 'started_ms', 'ended_ms',
  'elapsed_sec', 'overtime_sec', 'end_reason', 'deleted_ms',
] as const;

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

function sessionRows(db: Db, ids: string[]): Row[] {
  return db.all(`SELECT * FROM sessions WHERE id IN (${marks(ids.length)})`, ...ids);
}

function writeSessionRow(db: Db, r: Row): void {
  db.run(
    `UPDATE sessions SET ${SESSION_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...SESSION_COLUMNS.map((c) => r[c] ?? null),
    r.id,
  );
}

/** elapsed_sec = Σ closed segments (ADR-0004); overtime from the plan once the session is finished. */
function resync(db: Db, id: string): void {
  db.run(
    `UPDATE sessions SET elapsed_sec = (SELECT COALESCE(ROUND(SUM(end_ms - start_ms) / 1000.0), 0) FROM segments WHERE session_id = ? AND end_ms IS NOT NULL)
      WHERE id = ?`,
    id, id,
  );
  db.run(
    `UPDATE sessions SET overtime_sec = CASE WHEN planned_sec IS NULL OR ended_ms IS NULL THEN overtime_sec ELSE MAX(0, elapsed_sec - planned_sec) END
      WHERE id = ?`,
    id,
  );
}

function datesOf(rows: Row[], nowMs: number): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    out.add(dateKey(r.started_ms as number));
    out.add(dateKey((r.ended_ms as number | null) ?? nowMs));
  }
  return [...out];
}

const sessionName = (r: Row) => (r.name as string | null) ?? (r.kind === 'break' ? 'Break' : 'Unlabelled session');

export class SessionEditor {
  private last: Undo | null = null;
  private readonly app: AppCtx;
  private readonly host: EngineHost;

  constructor(app: AppCtx, host: EngineHost) {
    this.app = app;
    this.host = host;
  }

  private get db(): Db {
    return this.app.db;
  }

  private now(): number {
    return this.app.clock.now();
  }

  private finish(u: Undo): void {
    this.last = u;
    for (const d of u.dates) refreshReview(this.db, d, this.now(), this.app.settings);
    this.host.dataChanged();
  }

  /** P53: the session is hidden and its time becomes untracked. */
  delete(id: string): EditResult {
    const db = this.db;
    const before = sessionRows(db, [id])[0];
    if (!before || before.deleted_ms !== null) return { error: 'invalid', message: 'No such session' };
    const cur = this.host.state.current;
    const wasRunning = cur?.id === id ? structuredClone(cur) : null;
    const err = this.host.dispatch({ type: 'DROP', sessionId: id });
    if (err) return err;
    // The row after the engine closed it (if it was running): that's what Undo puts back if it can't resume it.
    const row = sessionRows(db, [id])[0];
    const away = db.all<{ id: string; interrupted_session_id: string | null }>(
      'SELECT id, interrupted_session_id FROM away_periods WHERE interrupted_session_id = ?',
      id,
    );
    db.transaction(() => {
      db.run('UPDATE sessions SET deleted_ms = ? WHERE id = ?', this.now(), id);
      db.run('UPDATE away_periods SET interrupted_session_id = NULL WHERE interrupted_session_id = ?', id);
    });
    const fresh = this.host.state.current;
    this.finish({
      id: randomUUID(),
      sessions: [row],
      segments: [],
      away,
      flags: [],
      dates: datesOf([row], this.now()),
      live:
        wasRunning && fresh
          ? { active: { ...wasRunning, accumulatedSec: elapsedSec(wasRunning, row.ended_ms as number), segmentId: null, segmentStartMs: null }, freshId: fresh.id }
          : undefined,
    });
    return { ok: true, undoId: this.last!.id, message: `Deleted “${sessionName(row)}”` };
  }

  /** P54: `ids` (including `keepId`) become `keepId`, which keeps its label, kind and plan. */
  merge(keepId: string, ids: string[]): EditResult {
    const db = this.db;
    const all = [...new Set([keepId, ...ids])];
    const absorbedIds = all.filter((x) => x !== keepId);
    if (!absorbedIds.length) return { error: 'invalid', message: 'Pick at least two sessions' };
    const rows = sessionRows(db, all);
    if (rows.length !== all.length || rows.some((r) => r.deleted_ms !== null)) return { error: 'invalid', message: 'No such session' };
    if (new Set(rows.map((r) => dateKey(r.started_ms as number))).size > 1) return { error: 'invalid', message: 'Only sessions from the same day can be merged' };
    const breaks = rows.filter((r) => r.kind === 'break').length;
    if (breaks && breaks !== rows.length) return { error: 'invalid', message: 'Breaks merge only with breaks' };
    const st = this.host.state;
    if (st.current && absorbedIds.includes(st.current.id)) keepId = st.current.id;
    const absorbed = all.filter((x) => x !== keepId);

    const segments = db.all<{ id: string; session_id: string; start_ms: number; end_ms: number | null }>(
      `SELECT id, session_id, start_ms, end_ms FROM segments WHERE session_id IN (${marks(absorbed.length)})`,
      ...absorbed,
    );
    const addSec = segments.reduce((t, g) => t + (g.end_ms === null ? 0 : (g.end_ms - g.start_ms) / 1000), 0);
    const err = this.host.dispatch({ type: 'ABSORB', sessionId: keepId, addSec, removedIds: absorbed });
    if (err) return err;

    const inList = `IN (${marks(absorbed.length)})`;
    const away = db.all<{ id: string; interrupted_session_id: string | null }>(
      `SELECT id, interrupted_session_id FROM away_periods WHERE interrupted_session_id ${inList}`,
      ...absorbed,
    );
    const flags = db.all<{ id: string; session_id: string | null }>(`SELECT id, session_id FROM distraction_flags WHERE session_id ${inList}`, ...absorbed);
    const keep = rows.find((r) => r.id === keepId)!;
    const now = this.now();
    db.transaction(() => {
      db.run(`UPDATE segments SET session_id = ? WHERE session_id ${inList}`, keepId, ...absorbed);
      db.run(`UPDATE away_periods SET interrupted_session_id = ? WHERE interrupted_session_id ${inList}`, keepId, ...absorbed);
      db.run(`UPDATE distraction_flags SET session_id = ? WHERE session_id ${inList}`, keepId, ...absorbed);
      db.run(`UPDATE sessions SET deleted_ms = ? WHERE id ${inList}`, now, ...absorbed);
      const start = Math.min(...rows.map((r) => r.started_ms as number));
      const end = keep.ended_ms === null ? null : Math.max(...rows.map((r) => (r.ended_ms as number | null) ?? now));
      db.run('UPDATE sessions SET started_ms = ?, ended_ms = ? WHERE id = ?', start, end, keepId);
      resync(db, keepId);
    });
    this.finish({
      id: randomUUID(),
      sessions: rows,
      segments: segments.map((g) => ({ id: g.id, session_id: g.session_id })),
      away,
      flags,
      dates: datesOf(rows, now),
      absorbed: st.current?.id === keepId ? { keepId, sec: addSec } : undefined,
    });
    return { ok: true, undoId: this.last!.id, message: `Merged ${all.length} sessions into “${sessionName(keep)}”` };
  }

  /** Puts the last edit back exactly. Only the most recent edit can be undone. */
  undo(undoId: string): { ok: true } | EngineError {
    const u = this.last;
    if (!u || u.id !== undoId) return { error: 'invalid', message: 'Nothing to undo' };
    this.last = null;
    const db = this.db;
    if (u.absorbed) this.host.dispatch({ type: 'ABSORB', sessionId: u.absorbed.keepId, addSec: -u.absorbed.sec, removedIds: [] });
    const resumed = u.live ? !this.host.dispatch({ type: 'RESTORE', active: u.live.active, replacesId: u.live.freshId }) : false;
    db.transaction(() => {
      for (const r of u.sessions) writeSessionRow(db, r);
      for (const g of u.segments) db.run('UPDATE segments SET session_id = ? WHERE id = ?', g.session_id, g.id);
      for (const a of u.away) db.run('UPDATE away_periods SET interrupted_session_id = ? WHERE id = ?', a.interrupted_session_id, a.id);
      for (const f of u.flags) db.run('UPDATE distraction_flags SET session_id = ? WHERE id = ?', f.session_id, f.id);
      if (u.live && resumed) {
        // The deleted session takes over the fresh open session's segment and runs on.
        const { active, freshId } = u.live;
        for (const t of ['segments', 'distraction_flags']) db.run(`UPDATE ${t} SET session_id = ? WHERE session_id = ?`, active.id, freshId);
        db.run('UPDATE away_periods SET interrupted_session_id = ? WHERE interrupted_session_id = ?', active.id, freshId);
        db.run('DELETE FROM sessions WHERE id = ?', freshId);
        db.run("UPDATE sessions SET status = 'running', ended_ms = NULL, end_reason = NULL, overtime_sec = 0 WHERE id = ?", active.id);
      }
      for (const r of u.sessions) resync(db, r.id as string);
    });
    for (const d of u.dates) refreshReview(db, d, this.now(), this.app.settings);
    this.host.dataChanged();
    return { ok: true };
  }
}
