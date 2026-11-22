// Engine types (plan §7).
import type { Settings } from './settings';

export type Kind = 'planned' | 'timed' | 'open' | 'break';
export type Direction = 'up' | 'down';
export type AwayReason = 'idle' | 'suspend' | 'lock' | 'not_running';
export type AwayClassification = 'break' | 'meeting' | 'offline_work' | 'not_working' | 'working';
export type EndReason = 'done' | 'switched' | 'work_hours_end' | 'cap_24h' | 'checkin_fresh' | 'resumed';
export type SessionStatus = 'running' | 'paused' | 'interrupted' | 'done';

export interface Active {
  id: string;
  kind: Kind;
  name: string | null;
  projectId: string | null;
  plannedSec: number | null;
  direction: Direction | null;
  startedMs: number;
  accumulatedSec: number; // closed segments
  segmentId: string | null;
  segmentStartMs: number | null;
  timeUpAtMs: number | null;
  lastNagMs: number | null;
  lastCheckInMs: number;
}

export interface AwayState {
  startMs: number;
  reason: AwayReason;
  interrupted: Active | null;
}

export type PromptType = 'away' | 'recovery' | 'timeUp' | 'label' | 'breakEnd' | 'checkIn';

export interface Prompt {
  id: string;
  type: PromptType;
  sessionId?: string;
  awayId?: string;
  /** away/recovery: the recorded interval. */
  awayStartMs?: number;
  awayEndMs?: number;
  createdMs: number;
}

export interface EngineState {
  mode: 'off_hours' | 'working' | 'away';
  current: Active | null;
  paused: Active | null;
  away: AwayState | null;
  /** Kept ordered: by priority, then queue order (re-nag moves a prompt to the front of its priority). */
  prompts: Prompt[];
  reviewOpenedFor: string | null;
  lastHeartbeatMs: number | null;
}

export interface WorkWindow {
  startMs: number;
  endMs: number;
}

export type EngineSettings = Pick<
  Settings,
  'nagIntervalSec' | 'checkInIntervalSec' | 'shortAwayIgnoreSec' | 'keepWorkingStepMin' | 'defaultDirection'
>;

export interface Ctx {
  now: number;
  /** Work hours (after overrides) of the local day containing dateMs, or null on a day off. */
  window(dateMs: number): WorkWindow | null;
  settings: EngineSettings;
  newId(): string;
}

export interface StartInput {
  kind: Kind;
  name?: string | null;
  projectId?: string | null;
  plannedSec?: number | null;
  direction?: Direction | null;
}

export interface Heartbeat {
  tsMs: number;
  state: EngineState;
}

export type Answer =
  | { classification: AwayClassification; label?: string | null } // away / recovery
  | 'done'
  | 'switch'
  | 'back'
  | { extend: number } // timeUp / breakEnd
  | { name: string; projectId?: string | null } // label
  | { action: 'continue' | 'fresh'; name: string; projectId?: string | null } // checkIn
  | { action: 'still' };

export type EngineEvent =
  | { type: 'BOOT'; heartbeat: Heartbeat | null }
  | { type: 'TICK' }
  | ({ type: 'START' } & StartInput)
  | { type: 'DONE' }
  | { type: 'EXTEND'; sec: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'LABEL'; sessionId: string; name: string; projectId?: string | null }
  | { type: 'ANSWER'; promptId: string; answer: Answer }
  | { type: 'AWAY_BEGIN'; atMs: number; reason: AwayReason }
  | { type: 'AWAY_END' }
  | { type: 'KEEP_WORKING' }
  | { type: 'SCHEDULE_CHANGED' }
  /** E20 (P53): the session was deleted. */
  | { type: 'DROP'; sessionId: string }
  /** E21 (P54): `removedIds` were merged into `sessionId`, whose closed time grew by `addSec` (negative on undo). */
  | { type: 'ABSORB'; sessionId: string; addSec: number; removedIds: string[] }
  /** E22: undo of deleting the running session; `active` takes over the fresh open session `replacesId`. */
  | { type: 'RESTORE'; active: Active; replacesId: string };

export interface SessionInsertRow {
  id: string;
  kind: Kind;
  name: string | null;
  projectId: string | null;
  plannedSec: number | null;
  direction: Direction | null;
  status: SessionStatus;
  startedMs: number;
  createdMs: number;
}
export interface SessionUpdateRow {
  id: string;
  name?: string | null;
  projectId?: string | null;
  plannedSec?: number | null;
  status?: SessionStatus;
  endedMs?: number;
  elapsedSec?: number;
  overtimeSec?: number;
  endReason?: EndReason;
}
export interface SegmentRow {
  id: string;
  sessionId: string;
  startMs: number;
  endMs?: number | null;
  source: 'live' | 'away_working';
}
export interface AwayInsertRow {
  id: string;
  startMs: number;
  endMs: number;
  reason: AwayReason;
  interruptedSessionId: string | null;
}
export interface AwayUpdateRow {
  id: string;
  classification: AwayClassification;
  label: string | null;
  classifiedMs: number;
}

export type Effect =
  | { db: 'insertSession'; row: SessionInsertRow }
  | { db: 'updateSession'; row: SessionUpdateRow }
  | { db: 'openSegment'; row: SegmentRow }
  | { db: 'closeSegment'; row: { id: string; endMs: number } }
  | { db: 'insertSegment'; row: SegmentRow & { endMs: number } }
  | { db: 'insertAway'; row: AwayInsertRow }
  | { db: 'updateAway'; row: AwayUpdateRow }
  | { ring: true }
  | { promptsChanged: true }
  | { openReview: string }
  | { setDayOverride: { date: string; endMin: number } }
  | { openStartPopover: true }
  | { saveHeartbeat: true };

export type EngineError =
  | { error: 'needs_label'; sessionId: string }
  | { error: 'unknown_prompt' }
  | { error: 'invalid'; message: string };

export interface ReduceResult {
  state: EngineState;
  effects: Effect[];
  error?: EngineError;
}
