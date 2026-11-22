-- ADR-0011, P58–P65 (2026-11-22): blocks replace sessions. Blocks keep the sessions and segments tables:
-- a block is a session of kind 'open' (work; name NULL = not accounted for yet) or 'break'.
-- A session still open when Spyder last ran ends at the last heartbeat.
UPDATE segments SET end_ms = MAX(start_ms, COALESCE((SELECT ts_ms FROM heartbeat WHERE id = 1), start_ms)) WHERE end_ms IS NULL;
UPDATE sessions SET
  status = 'done',
  ended_ms = COALESCE((SELECT MAX(g.end_ms) FROM segments g WHERE g.session_id = sessions.id), started_ms),
  elapsed_sec = (SELECT COALESCE(ROUND(SUM(g.end_ms - g.start_ms) / 1000.0), 0) FROM segments g WHERE g.session_id = sessions.id),
  end_reason = COALESCE(end_reason, 'done')
WHERE status <> 'done';
DELETE FROM heartbeat;
-- P65: each old session is one block of its own length; planned and timed become ordinary blocks; projects go.
UPDATE sessions SET kind = 'open', planned_sec = NULL, direction = NULL, overtime_sec = 0 WHERE kind IN ('planned', 'timed');
UPDATE sessions SET project_id = NULL;
-- Old away periods: Break → break block; Meeting / Offline work → a block with that answer. Working already
-- has its segment in a session; Not working and unclassified become untracked.
INSERT INTO sessions (id, kind, name, status, started_ms, ended_ms, elapsed_sec, end_reason, created_ms)
  SELECT 'away-' || id,
    CASE classification WHEN 'break' THEN 'break' ELSE 'open' END,
    CASE classification WHEN 'break' THEN 'Break' WHEN 'meeting' THEN COALESCE(label, 'Meeting') ELSE COALESCE(label, 'Offline work') END,
    'done', start_ms, end_ms, ROUND((end_ms - start_ms) / 1000.0), 'done', COALESCE(classified_ms, end_ms)
  FROM away_periods WHERE classification IN ('break', 'meeting', 'offline_work');
INSERT INTO segments (id, session_id, start_ms, end_ms, source)
  SELECT 'away-seg-' || id, 'away-' || id, start_ms, end_ms, 'live'
  FROM away_periods WHERE classification IN ('break', 'meeting', 'offline_work');
DELETE FROM away_periods;
DELETE FROM settings WHERE key IN ('checkInIntervalSec', 'nagIntervalSec', 'defaultDirection', 'shortAwayIgnoreSec');
