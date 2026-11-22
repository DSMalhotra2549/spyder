// Editing blocks after the fact (P64, P66): delete, merge and tag, each with one-step Undo. Answering and
// re-answering go through EngineHost.answer. The running block can't be edited until it ends.
import { randomUUID } from 'node:crypto';
import { dateKey } from '../core/schedule';
import type { EngineError, Tag } from '../core/types';
import type { AppCtx } from './context';
import type { Db, Row } from './db/db';
import { BREAK_NAME } from './db/repo';
import type { EngineHost } from './engineHost';
import { refreshReview } from './report';

export type EditResult = { ok: true; undoId: string; message: string } | EngineError;

interface Undo {
  id: string;
  /** Full `sessions` rows as they were before the edit. */
  blocks: Row[];
  /** Segment → block links before a merge. */
  segments: { id: string; session_id: string }[];
  flags: { id: string; session_id: string | null }[];
  dates: string[];
}

const COLUMNS = ['kind', 'name', 'status', 'started_ms', 'ended_ms', 'elapsed_sec', 'deleted_ms'] as const;
/** Blocks this close count as adjacent (rows store ms; boundaries are exact, rounding isn't). */
const ADJACENT_MS = 1000;

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');
const invalid = (message: string): EngineError => ({ error: 'invalid', message });
const answerOf = (r: Row) => (r.name as string | null) ?? 'Unanswered block';

export class BlockEditor {
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

  /** The rows for `ids`, or why they can't be edited. */
  private load(ids: string[]): Row[] | EngineError {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return invalid('Pick a block');
    const rows = this.db.all(`SELECT * FROM sessions WHERE id IN (${marks(uniq.length)}) ORDER BY started_ms`, ...uniq);
    if (rows.length !== uniq.length || rows.some((r) => r.deleted_ms !== null)) return invalid('No such block');
    const running = this.host.state.loop?.block.id;
    if (rows.some((r) => r.id === running || r.status !== 'done')) return invalid('The running block can’t be edited until it ends');
    return rows;
  }

  private finish(u: Undo, message: string): EditResult {
    this.last = u;
    for (const d of u.dates) refreshReview(this.db, d, this.app.clock.now(), this.app.settings);
    this.host.dataChanged();
    return { ok: true, undoId: u.id, message };
  }

  /** The blocks are hidden and their time becomes untracked. */
  delete(ids: string[]): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    this.db.run(`UPDATE sessions SET deleted_ms = ? WHERE id IN (${marks(rows.length)})`, this.app.clock.now(), ...rows.map((r) => r.id));
    const message = rows.length === 1 ? `Deleted “${answerOf(rows[0])}”` : `Deleted ${rows.length} blocks`;
    return this.finish({ id: randomUUID(), blocks: rows, segments: [], flags: [], dates: [...new Set(rows.map((r) => dateKey(r.started_ms as number)))] }, message);
  }

  /** Adjacent blocks of one tag become the earliest one, longer, with one answer (a break's may be null). */
  merge(ids: string[], answer: string | null): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    if (rows.length < 2) return invalid('Pick at least two blocks');
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs((rows[i].started_ms as number) - (rows[i - 1].ended_ms as number)) > ADJACENT_MS) return invalid('Only blocks next to each other can be merged');
    }
    const breaks = rows.filter((r) => r.kind === 'break').length;
    if (breaks && breaks !== rows.length) return invalid('A break can’t be merged with work blocks. Change their tags first.');
    const isBreak = breaks > 0;
    // A work block needs an answer; a break may have none (P66).
    const text = answer?.trim() || null;
    if (!isBreak && text === null) return invalid('Say what you did, or pick Break');
    const name = text ?? (isBreak ? BREAK_NAME : null);

    const db = this.db;
    const keep = rows[0];
    const rest = rows.slice(1).map((r) => r.id as string);
    const inList = `IN (${marks(rest.length)})`;
    const segments = db.all<{ id: string; session_id: string }>(`SELECT id, session_id FROM segments WHERE session_id ${inList}`, ...rest);
    const flags = db.all<{ id: string; session_id: string | null }>(`SELECT id, session_id FROM distraction_flags WHERE session_id ${inList}`, ...rest);
    const end = rows[rows.length - 1].ended_ms as number;
    db.transaction(() => {
      db.run(`UPDATE segments SET session_id = ? WHERE session_id ${inList}`, keep.id, ...rest);
      db.run(`UPDATE distraction_flags SET session_id = ? WHERE session_id ${inList}`, keep.id, ...rest);
      db.run(`UPDATE sessions SET deleted_ms = ? WHERE id ${inList}`, this.app.clock.now(), ...rest);
      db.run(
        `UPDATE sessions SET kind = ?, name = ?, ended_ms = ?,
           elapsed_sec = (SELECT COALESCE(ROUND(SUM(end_ms - start_ms) / 1000.0), 0) FROM segments WHERE session_id = ?) WHERE id = ?`,
        isBreak ? 'break' : 'open', name, end, keep.id, keep.id,
      );
    });
    return this.finish(
      { id: randomUUID(), blocks: rows, segments, flags, dates: [dateKey(keep.started_ms as number)] },
      `Merged ${rows.length} blocks into “${name}”`,
    );
  }

  /**
   * Sets the blocks' tag (P66). Answers stay; a break without an answer of its own that becomes work isn't
   * accounted for any more, and an unanswered block that becomes a break is.
   */
  tag(ids: string[], tag: Tag): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    const list = `IN (${marks(rows.length)})`;
    const rowIds = rows.map((r) => r.id);
    if (tag === 'break') this.db.run(`UPDATE sessions SET kind = 'break', name = COALESCE(name, ?) WHERE id ${list}`, BREAK_NAME, ...rowIds);
    else this.db.run(`UPDATE sessions SET name = CASE WHEN kind = 'break' AND name = ? THEN NULL ELSE name END, kind = 'open' WHERE id ${list}`, BREAK_NAME, ...rowIds);
    const what = tag === 'break' ? 'Break' : 'Work';
    const message = rows.length === 1 ? `“${answerOf(rows[0])}” is now ${tag === 'break' ? 'a break' : 'work'}` : `Tagged ${rows.length} blocks ${what}`;
    return this.finish({ id: randomUUID(), blocks: rows, segments: [], flags: [], dates: [...new Set(rows.map((r) => dateKey(r.started_ms as number)))] }, message);
  }

  /** Puts the last edit back exactly. Only the most recent edit can be undone. */
  undo(undoId: string): { ok: true } | EngineError {
    const u = this.last;
    if (!u || u.id !== undoId) return invalid('Nothing to undo');
    this.last = null;
    const db = this.db;
    db.transaction(() => {
      for (const r of u.blocks) db.run(`UPDATE sessions SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...COLUMNS.map((c) => r[c] ?? null), r.id);
      for (const g of u.segments) db.run('UPDATE segments SET session_id = ? WHERE id = ?', g.session_id, g.id);
      for (const f of u.flags) db.run('UPDATE distraction_flags SET session_id = ? WHERE id = ?', f.session_id, f.id);
    });
    for (const d of u.dates) refreshReview(db, d, this.app.clock.now(), this.app.settings);
    this.host.dataChanged();
    return { ok: true };
  }
}
