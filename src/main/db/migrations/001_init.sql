CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_ms INTEGER NOT NULL);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT '#8B5CF6', archived INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                                  -- crypto.randomUUID()
  kind TEXT NOT NULL CHECK (kind IN ('planned','timed','open','break')),
  name TEXT,                                            -- NULL = unlabelled (P21); 'Unknown' allowed from review
  project_id TEXT REFERENCES projects(id),
  planned_sec INTEGER,                                  -- NULL for open sessions / unplanned breaks
  direction TEXT CHECK (direction IN ('up','down')),    -- planned only
  status TEXT NOT NULL CHECK (status IN ('running','paused','interrupted','done')),
  started_ms INTEGER NOT NULL, ended_ms INTEGER,
  elapsed_sec INTEGER NOT NULL DEFAULT 0,               -- sum of closed segments (kept in sync on segment close)
  overtime_sec INTEGER NOT NULL DEFAULT 0,              -- max(0, elapsed - planned) at close
  end_reason TEXT CHECK (end_reason IN ('done','switched','work_hours_end','cap_24h','checkin_fresh','resumed')),
  created_ms INTEGER NOT NULL);
CREATE INDEX idx_sessions_started ON sessions(started_ms);
CREATE TABLE segments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL, end_ms INTEGER,           -- end NULL = currently open
  source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live','away_working')));
CREATE INDEX idx_segments_start ON segments(start_ms);
CREATE TABLE away_periods (
  id TEXT PRIMARY KEY, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('idle','suspend','lock','not_running')),
  classification TEXT CHECK (classification IN ('break','meeting','offline_work','not_working','working')), -- NULL = pending
  label TEXT, interrupted_session_id TEXT REFERENCES sessions(id), classified_ms INTEGER);
CREATE INDEX idx_away_start ON away_periods(start_ms);
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  exe TEXT NOT NULL,                                    -- lowercase basename, e.g. 'chrome.exe'
  app_name TEXT NOT NULL, title TEXT,                   -- title NULL for private windows
  domain TEXT,                                          -- host without 'www.', NULL if unknown / not a browser
  browser TEXT CHECK (browser IN ('chrome','firefox','edge')),
  is_private INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_activity_start ON activity(start_ms);
CREATE TABLE distraction_flags (
  id TEXT PRIMARY KEY, ts_ms INTEGER NOT NULL, session_id TEXT REFERENCES sessions(id),
  target TEXT NOT NULL, continuous_sec INTEGER NOT NULL);
CREATE TABLE rules (
  id TEXT PRIMARY KEY, match_type TEXT NOT NULL CHECK (match_type IN ('app','domain','title')),
  pattern TEXT NOT NULL,                                -- lowercase. app: exe name; domain: host or suffix; title: substring
  category TEXT NOT NULL CHECK (category IN ('productive','neutral','distracting')),
  is_default INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL,
  UNIQUE (match_type, pattern, is_default));
CREATE TABLE title_patterns (
  id TEXT PRIMARY KEY, match TEXT NOT NULL CHECK (match IN ('suffix','prefix','contains')),
  pattern TEXT NOT NULL, domain TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE schedule (weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  enabled INTEGER NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL);
CREATE TABLE day_overrides (date TEXT PRIMARY KEY,     -- 'YYYY-MM-DD' local
  enabled INTEGER NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL);
CREATE TABLE reviews (date TEXT PRIMARY KEY, completed_ms INTEGER, productive_sec INTEGER, work_sec INTEGER,
  scheduled_sec INTEGER, goal_sec INTEGER, goal_met INTEGER, score REAL);
CREATE TABLE review_items (id TEXT PRIMARY KEY, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('win','improve')), text TEXT NOT NULL, sort INTEGER NOT NULL, created_ms INTEGER NOT NULL);
CREATE TABLE kpis (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, unit TEXT, archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL);
CREATE TABLE kpi_values (date TEXT NOT NULL, kpi_id TEXT NOT NULL REFERENCES kpis(id), value REAL NOT NULL, PRIMARY KEY (date, kpi_id));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);            -- JSON-encoded
CREATE TABLE heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), ts_ms INTEGER NOT NULL, engine_state TEXT NOT NULL);
