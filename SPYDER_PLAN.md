# SPYDER_PLAN.md: implementation plan for Spyder

Spyder is a personal Windows app that holds the user accountable for their time. It has a Rize-style floating timer widget. Every minute of work hours belongs to a labelled session. Away and sleep time is accounted for. Foreground apps and websites are tracked. There are daily, weekly and monthly reports with charts, an end-of-day review, and spreadsheet export. **No AI.**

## 0. Read these first (in this order)
1. `CONTEXT.md`: the glossary. Use these terms exactly in code, UI and commits (Session, Segment, Away period, Check-in, Nudge, Review, ...).
2. `docs/product-decisions.md`: every settled behavior decision (P1–P30) and why. **Don't re-ask these.**
3. `docs/adr/`: architectural decisions (ADR-0001…0010) and why.
4. This file: the exact spec and the phases.

## 1. Rules for the implementing agent
1. **Work one phase at a time, in order.** A phase is done only when *every* item in its **Verify** list passes. Then append to the Progress log (§14) and commit with the given message. Local git only; never push.
2. **View your own screenshots.** E2E tests save PNGs to `tests/e2e/__shots__/`. Open each one with the Read tool and compare it with `design/DESIGN.md`. Fix visual problems before moving on.
3. **Never weaken, skip or delete a test to make it pass.** If a spec item seems wrong, ask the user.
4. **If stuck:** after 3 failed attempts at the same problem, stop and ask the user (AskUserQuestion). Include the exact error output and what you tried.
5. **Ask the user** only about behavior not covered by this file or `docs/product-decisions.md`. Record each new decision in `docs/product-decisions.md` (the next P number) and record new architectural decisions as ADRs.
6. **Keep `src/core/` pure**: no `electron`, `node:fs`, `node:sqlite` or `Date.now()` imports there. Time comes from the `ctx.now` argument (ADR-0006).
7. Use **TypeScript strict**. No `any` without a `// reason:` comment. Use only erasable TS syntax in `scripts/` (no `enum`, no parameter properties).
8. Shell: the machine is Windows 11. PowerShell and Git Bash are both available. Use forward-slash paths in Node code (`path.join`).

## 2. Environment and versions (checked 2026-11-21)
- Node **v25.9.0**, npm 11.5.2, git 2.44, Python 3.13. **No .NET SDK.**
- .NET Framework compiler: `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. UIA assemblies are in `...\v4.0.30319\WPF\` (ADR-0008).
- Latest Electron is **45.4.1** (bundles **Node 24.22.3**, Chromium 156). Pin `electron@45`.
- Package versions at planning time: `electron-vite@6`, `@miniben90/x-win@3.7.0`. Use whatever `npm install` resolves for the others, then record the versions in the Progress log.
- Browsers used: **Chrome and Firefox**.

**Dependencies:**
- Runtime: `react react-dom zustand date-fns recharts exceljs clsx @miniben90/x-win`
- Dev: `electron@45 electron-vite vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest @vitest/coverage-v8 @playwright/test playwright tsx eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier electron-builder`

## 3. Known pitfalls (read before Phase 1)
- **`node:sqlite` is not on Vite's builtin list.** In `electron.vite.config.ts`, add `'node:sqlite'` to `main.build.rollupOptions.external`. Otherwise the build fails with "failed to resolve node:sqlite".
- **x-win is a native addon** (a prebuilt `.node`, N-API, so no rebuild needed). Externalize `@miniben90/x-win` in the main build, and set `asarUnpack: ["**/*.node"]` in electron-builder config.
- **Don't add `"type": "module"`** to package.json. electron-vite's default CommonJS output for main and preload is what we want.
- Call `app.setAppUserModelId('com.spyder.app')` at startup, or Windows toast notifications won't appear.
- Call `app.setName('Spyder')` **before** `app.whenReady()`. Data dir = `process.env.SPYDER_DATA_DIR ?? path.join(app.getPath('appData'), 'Spyder')`.
- `powerMonitor` can only be used after `app.whenReady()`. `powerMonitor.getSystemIdleTime()` returns **seconds**.
- Transparent frameless windows on Windows need `transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false`. The drag area uses CSS `-webkit-app-region: drag`, and every button inside it needs `-webkit-app-region: no-drag`.
- When restoring the widget position, check it is still on a connected display (`screen.getDisplayMatching`). If not, reset it to top-center of the primary display.
- `globalShortcut.register` returns `false` if the combo is taken. Show a warning in Settings; don't crash.
- Use `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload }`. Expose the API only through `contextBridge`.
- Store all timestamps as **epoch milliseconds (UTC)**. Compute "days" in **local time** with date-fns (P30).
- Git: add `.gitattributes` with `* text=auto eol=lf` so CRLF warnings don't pollute diffs.
- Playwright: `_electron.launch()` is marked experimental. If it fails to attach to Electron 45, fall back to launching with `--remote-debugging-port=9223` and `chromium.connectOverCDP('http://127.0.0.1:9223')`. Record which one worked in the Progress log.
- `node:sqlite` fallback (ADR-0003): if `require('node:sqlite')` throws inside Electron, switch to `better-sqlite3` + `@electron/rebuild`. Keep all SQL behind `src/main/db/db.ts` so the switch touches one file.

## 4. Architecture
```
Main process (src/main)                                    Renderer (src/renderer, one bundle, hash routes)
 ├─ engine host: holds EngineState, runs a TICK every 1 s     ├─ #/widget     floating widget
 │   (clock time) and applies effects (DB, ring, prompts)   ├─ #/prompt     prompt window (one at a time)
 ├─ idle.ts: powerMonitor → AWAY_BEGIN / AWAY_END           └─ #/dashboard/{today,week,month,review,rules,settings}
 ├─ tracker.ts: samples every 2 s → activity rows + nudge
 │    ├─ capture/foreground.ts (x-win in utilityProcess)
 │    ├─ capture/chromeUrl.ts (UrlHelper.exe over stdin/stdout)
 │    └─ capture/firefoxTitle.ts
 ├─ db/ (node:sqlite) · ipc.ts · windows.ts · tray.ts · hotkey.ts · notify.ts · export.ts · debug.ts
Core (src/core, pure): clock · types · schedule · sessionEngine · nudge · categorize · titlePatterns · merge · aggregate · streaks · format
```

**Layout:**
```
src/core/            *.ts + *.test.ts (Vitest)
src/main/            main.ts, engineHost.ts, idle.ts, tracker.ts, windows.ts, tray.ts, hotkey.ts, ipc.ts, notify.ts, export.ts, debug.ts, settings.ts
src/main/capture/    foreground.ts, foregroundProbe.ts (utilityProcess entry), chromeUrl.ts, firefoxTitle.ts
src/main/db/         db.ts, migrate.ts, repo.ts, migrations/001_init.sql, seedDefaults.ts
src/preload/         index.ts (contextBridge → window.spyder), api.d.ts
src/renderer/        index.html, main.tsx, router.tsx, styles.css, ui/, widget/, prompt/, dashboard/
src/native/          UrlHelper.cs
scripts/             build-helper.ps1, make-icon.ps1, db-dump.ts, seed.ts, capture-check.ts, soak.ts
resources/           icon.png, icon.ico, UrlHelper.exe (built)
design/              reference/*.png, DESIGN.md
tests/e2e/           *.spec.ts, helpers.ts, __shots__/
```

## 5. Settings (`settings` table, JSON values) and defaults
| key | default | meaning |
|---|---|---|
| goalSec | 18000 (5 h) | daily productive goal (P24) |
| idleThresholdSec | 300 | P7 |
| checkInIntervalSec | 1800 | P8 |
| nagIntervalSec | 300 | P5 re-nag |
| nudgeAfterSec | 300 | P13 |
| nudgeRepeatSec | 300 | P13 |
| nudgeResetSec | 60 | P14 |
| shortAwayIgnoreSec | 60 | away periods shorter than this are ignored (short locks) |
| defaultDirection | "down" | P4 |
| hotkey | "Control+Alt+S" | P23 |
| autostart | true | P29 |
| sampleIntervalSec | 2 | tracker |
| appPercentScope | "work_hours" | P26 ("work_hours" \| "all_day") |
| keepWorkingStepMin | 30 | P20 |
| widgetPos | null | `{x,y}`, saved on move |
| widgetStyle | "full" | P31 (`"full"` \| `"compact"`) |

Default schedule (P10): weekday 1–5 (Mon–Fri) enabled 600–1020 (10:00–17:00), with 0 and 6 disabled. `weekday` uses JS `Date.getDay()` numbering (0 = Sunday).

## 6. Data model: `src/main/db/migrations/001_init.sql`
```sql
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
```
- Run `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` on open.
- `seedDefaults.ts` inserts the default schedule, settings, rules (§9.4) and title patterns (§9.3) only if the tables are empty.

## 7. Session engine spec: `src/core/sessionEngine.ts`
This is a pure reducer: `reduce(state, event, ctx) → { state, effects }`.
`ctx = { now: number, window(dateMs) → {startMs,endMs} | null, settings, newId() → string }`. `window()` returns today's work hours after overrides, or null on a day off.

```ts
type Kind = 'planned' | 'timed' | 'open' | 'break';
interface Active { id: string; kind: Kind; name: string | null; projectId: string | null;
  plannedSec: number | null; direction: 'up' | 'down' | null;
  accumulatedSec: number;            // closed segments
  segmentId: string | null; segmentStartMs: number | null;
  timeUpAtMs: number | null; lastNagMs: number | null; lastCheckInMs: number; }
interface EngineState {
  mode: 'off_hours' | 'working' | 'away';
  current: Active | null;            // running session while mode === 'working'
  paused: Active | null;             // session suspended by PAUSE (current is then a break), P17
  away: { startMs: number; reason: 'idle'|'suspend'|'lock'|'not_running'; interrupted: Active | null } | null;
  prompts: Prompt[];                 // queue; visible = first after sorting by (priority, createdMs)
  reviewOpenedFor: string | null;    // 'YYYY-MM-DD'
}
type PromptType = 'away' | 'recovery' | 'timeUp' | 'label' | 'breakEnd' | 'checkIn';
interface Prompt { id: string; type: PromptType; sessionId?: string; awayId?: string; createdMs: number; }
// priority: away/recovery = 0; timeUp/label/breakEnd = 1; checkIn = 2. Dedupe by (type, sessionId).
```
`elapsed(a) = a.accumulatedSec + (a.segmentStartMs ? (now - a.segmentStartMs)/1000 : 0)`. `inWork(now) = window(now) && start ≤ now < end`.

**Events:** `BOOT{heartbeat}`, `TICK`, `START{kind,name?,projectId?,plannedSec?,direction?}`, `DONE`, `EXTEND{sec}`, `PAUSE`, `RESUME`, `LABEL{sessionId,name,projectId}`, `ANSWER{promptId,answer}`, `AWAY_BEGIN{atMs,reason}`, `AWAY_END`, `KEEP_WORKING`, `SCHEDULE_CHANGED`.

**Effects:**
- `{db:'insertSession'|'updateSession'|'openSegment'|'closeSegment'|'insertSegment'|'insertAway'|'updateAway', row}`
- `{ring}`
- `{promptsChanged}`
- `{openReview:date}`
- `{setDayOverride:{date,endMin}}`
- `{openStartPopover}`
- `{saveHeartbeat}`

**Rules:**
- **E1 BOOT.**
  - No heartbeat: behave like TICK.
  - Heartbeat with `mode='working'`: if `now − hb.ts ≤ 60 s`, restore the state. Close the stale open segment at `hb.ts` and open a new one at `now`. Otherwise, apply AWAY_BEGIN{atMs: hb.ts, reason:'not_running'} to the restored state, then AWAY_END. This produces a `recovery` prompt.
  - Heartbeat with `mode='away'`: restore and apply AWAY_END.
- **E2 TICK, off_hours.** If `inWork(now)`, start an open session (E10) and set `mode='working'`.
- **E3 TICK, working.** In order:
  - (a) If `!inWork(now)` and today's window has ended: close `current` and `paused` at `window.endMs` (`work_hours_end`). Queue a `label` prompt for an unlabelled non-break session. Set `mode='off_hours'`. Emit `openReview(today)` if `reviewOpenedFor ≠ today` (P20).
  - (b) planned/timed/break with `plannedSec`: when `elapsed ≥ plannedSec` and `timeUpAtMs == null`, set `timeUpAtMs = lastNagMs = now`, ring, and queue `timeUp` (planned), `label` (timed) or `breakEnd` (break).
  - (c) If `timeUpAtMs != null`, its prompt is still queued, and `now − lastNagMs ≥ nagIntervalSec`: ring, set `lastNagMs = now`, and move that prompt to the front of its priority (P5).
  - (d) open: if `now − lastCheckInMs ≥ checkInIntervalSec` and no `checkIn` is queued, queue `checkIn` (P8).
  - (e) open: if `elapsed ≥ 86400`, close it (`cap_24h`), queue `label` if unlabelled, and start an open session.
  - (f) Every 15 s, emit `saveHeartbeat`.
- **E4 TICK, away.** Do nothing.
- **E5 AWAY_BEGIN.**
  - Ignore it if `mode ≠ 'working'` or `current.kind = 'break'` (P18).
  - Otherwise: close the current segment at `max(atMs, segmentStartMs)` and set the session status to `interrupted`. Set `away = {startMs: atMs, reason, interrupted: current}`, `current = null` and `mode = 'away'`.
  - If `paused` is set, it stays paused.
- **E6 AWAY_END.**
  - Let `end = now`. If today's window ended during the away period, `end = min(now, window.endMs)`.
  - If `end − startMs < shortAwayIgnoreSec`: resume the interrupted session with a new segment at `now`. No away period is recorded.
  - Otherwise: insert an away_period `[startMs, end]` with classification NULL, and queue `recovery` (if the reason was `not_running`) or `away`.
  - Then:
    - If `inWork(now)`: resume the interrupted session with a new segment at `now` (P19). If there was none, start an open session. Set `mode = 'working'`.
    - Else: close the interrupted session at `startMs` (`work_hours_end`), set `mode = 'off_hours'`, and emit `openReview`.
- **E7 ANSWER away/recovery** with `{classification, label?}`:
  - `offline_work` requires a label.
  - `working`: insert a segment `[start, end]` (`source='away_working'`) into the interrupted session and add it to `elapsed_sec`. If there was no interrupted session, create a `done` open session with that segment and queue `label` for it.
  - Update the away row.
- **E8 START.**
  - If `current` is a non-break session with `name == null`, reject with `{error:'needs_label', sessionId}`. The UI must send LABEL first (P21).
  - Close `current` and `paused` (`switched`). Insert the new session plus its first segment at `now`. For open sessions, set `lastCheckInMs = now`.
  - If START happens in off hours, emit `setDayOverride(today, endMin = minutes(now) + max(keepWorkingStepMin, ceil(plannedSec/60)))` and set `mode = 'working'`.
- **E9 DONE.**
  - On a break: if `paused`, RESUME (E12). Otherwise close the break (`done`) and start an open session.
  - Otherwise: close at `now` (`done`, with `overtime_sec`). Queue `label` if `name == null`. Start an open session if `inWork(now)`.
- **E10 startOpen.** Insert an open session with `name = null` and set `lastCheckInMs = now`.
- **E11 EXTEND{sec}.** Add `sec` to `plannedSec`. If `elapsed < plannedSec` now, clear `timeUpAtMs` and `lastNagMs`, and remove that session's `timeUp`, `label` or `breakEnd` prompt.
- **E12 PAUSE / RESUME.**
  - PAUSE (non-break only): close the segment, set `status = 'paused'`, `paused = current`. Then `current` = a new break session named `Paused`.
  - RESUME: close the break (`resumed`). `current = paused` with a new segment at `now`, `status = 'running'`, and `paused = null`.
- **E13 ANSWER timeUp:** `done` → DONE · `{extend: sec}` → EXTEND · `switch` → DONE + `openStartPopover`.
- **E14 ANSWER label `{name, projectId}`:** → LABEL.
- **E15 ANSWER checkIn:**
  - `{action:'continue', name, projectId}`: label current, `lastCheckInMs = now`.
  - `{action:'fresh', name, projectId}`: label, close (`checkin_fresh`), start an open session.
  - `{action:'still'}`: `lastCheckInMs = now`.
- **E16 ANSWER breakEnd:** `back` → DONE · `{extend: 300}` → EXTEND.
- **E17 LABEL.** Update the session row, update the state if it's `current` or `paused`, and remove `label` prompts for that session.
- **E18 KEEP_WORKING.** Emit `setDayOverride(today, endMin = max(scheduledEndMin, minutes(now)) + keepWorkingStepMin)`. Then, if `off_hours`, start an open session and set `mode = 'working'`.
- **E19 SCHEDULE_CHANGED.** Behave like TICK.

**Widget view model** (`widgetView(state, ctx, today)` in core):
```ts
{
  mode, kind,
  title,          // name ?? 'Untitled session'; 'Off hours' when off hours
  timerSec,       // see display rules below
  isOvertime, overtimeSec,
  workdayPct,     // 0–100, P11
  productiveTodaySec, goalSec,
  isDistracted, hasPrompt, isPaused
}
```
Display rules:
- planned, direction down: `max(planned − elapsed, 0)`. In overtime it shows `+mm:ss` in red.
- planned up, open and break: show elapsed.
- break with `plannedSec`: counts down.

## 8. Nudge spec: `src/core/nudge.ts` (P13, P14)
- Input per tracker sample: `{tsMs, category, target, inWorkSession}`. `inWorkSession` = mode working and current kind ≠ break.
- State: `{distractStartMs, nonDistractStartMs, lastNudgeMs}`.
- Not `inWorkSession`: reset everything immediately.
- `category === 'distracting'`: set `distractStartMs ??= ts` and `nonDistractStartMs = null`.
- Otherwise: set `nonDistractStartMs ??= ts`. If `ts − nonDistractStartMs ≥ nudgeResetSec`, reset `distractStartMs` and `lastNudgeMs`.
- Emit a nudge `{target, continuousSec}` when `distractStartMs` is set, `ts − distractStartMs ≥ nudgeAfterSec`, and `lastNudgeMs` is null or `ts − lastNudgeMs ≥ nudgeRepeatSec`. Then set `lastNudgeMs = ts`.
- `isDistracted` = `distractStartMs` set and `ts − distractStartMs ≥ nudgeAfterSec`.
- The main process stores each nudge in `distraction_flags` and shows a toast: `You're on {target} — "{session name or 'Untitled session'}" is running ({n} min)`.

## 9. Capture spec
### 9.1 Sampler (`tracker.ts`)
- Every `sampleIntervalSec` of **real** time. Timestamps come from the app `Clock`.
- Skip sampling while `mode = 'away'`, or when `powerMonitor.getSystemIdleTime() ≥ idleThresholdSec`.
- Sampling also continues in off hours (P10).
- Foreground (`foreground.ts`): run `foregroundProbe.ts` with `utilityProcess.fork`. It answers `'sample'` messages with `activeWindow().toObject()`, mapped to:
  - `title`
  - `exe` = lowercase basename of `info.path`
  - `appName` = `info.name`
- If the probe crashes, restart it with backoff of 1, 2, 4, 8 and 16 s, at most 5 restarts per 10 min. After that, mark capture as unavailable: Settings shows a banner and the session engine keeps working.
- Browser by exe:
  - `chrome.exe` → `chrome` (§9.2)
  - `msedge.exe` → `edge` (§9.2, best effort)
  - `firefox.exe` → `firefox` (§9.3)
- Merging (`core/merge.ts`): the key is `(exe, domain, title, isPrivate)`. A sample with the same key, arriving within `2 × interval + 1 s` of the previous one, extends the open row. Anything else closes the row with `end = min(lastSampleMs + interval, newSampleMs)` and starts a new one.
- Flush the open row on idle, away or quit, never past the last input time. Drop rows shorter than 1 s. Write in batches every 30 s and on flush.

### 9.2 Chrome URL helper (`src/native/UrlHelper.cs`, ADR-0008)
- A console app with `[STAThread] Main`. It reads stdin line by line and writes one JSON line per request to stdout, flushing after each.
  - `ping` → `{"ok":true}`
  - `fg` → `hwnd = GetForegroundWindow()` (P/Invoke user32) and `root = AutomationElement.FromHandle(hwnd)`. The omnibox is `root.FindFirst(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit), new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true)))`, **cached per hwnd** (re-find on `ElementNotAvailableException`). It reads `((ValuePattern)el.GetCurrentPattern(ValuePattern.Pattern)).Current.Value` and outputs `{"ok":true,"hwnd":<int>,"value":"<escaped>"}`.
  - Errors → `{"ok":false,"error":"<escaped>"}`. Write a small JSON string-escape function; don't reference any JSON library.
- Build script `scripts/build-helper.ps1`:
  ```powershell
  $fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
  & "$fw\csc.exe" /nologo /target:exe /platform:x64 /optimize+ /out:resources\UrlHelper.exe `
    /r:"$fw\WPF\UIAutomationClient.dll" /r:"$fw\WPF\UIAutomationTypes.dll" /r:"$fw\WPF\WindowsBase.dll" src\native\UrlHelper.cs
  ```
- Node client (`chromeUrl.ts`): spawn the helper once, with one request in flight at a time and an 800 ms timeout. On exit, restart it (at most 5 times per 10 min, then disable and fall back to `domain = null`).
- Parsing (`core/url.ts`):
  - Trim the value. If it's empty or contains a space (the user is typing), reuse the last domain for that hwnd while the title is unchanged; otherwise null.
  - If there's no scheme, prepend `https://`. Take `new URL().hostname`, lowercase it and strip a leading `www.`.
  - `chrome://` and `edge://` pages → domain `browser-internal`.

### 9.3 Firefox titles (`core/titlePatterns.ts`, ADR-0007)
- Strip the browser suffix with `/^(.*?)\s[—–-]\s(?:Mozilla\s)?Firefox(\sPrivate Browsing)?$/`. Group 2 present → `isPrivate = 1`, and store `title = null` and `domain = null`, displayed as "Private browsing".
- A title of just `Mozilla Firefox` → `domain = null` (new tab).
- Match the page title against `title_patterns` (case-insensitive, longest pattern first). No match → `domain = null`. Reports show it as `Firefox: <page title>`.
- Default title patterns (match, pattern → domain):
  - suffix: `- YouTube`→youtube.com · `- Gmail`→mail.google.com · `- Google Docs`→docs.google.com · `- Google Sheets`→docs.google.com · `- Google Slides`→docs.google.com · `- Google Search`→google.com · `- Google Calendar`→calendar.google.com · `- Stack Overflow`→stackoverflow.com · `- Wikipedia`→wikipedia.org · `- Reddit`→reddit.com · `/ X`→x.com · `- Twitch`→twitch.tv · `| TikTok`→tiktok.com · `| Facebook`→facebook.com · `| LinkedIn`→linkedin.com · `- Outlook`→outlook.office.com · `- Claude`→claude.ai · `| Netflix`→netflix.com
  - prefix: `GitHub - `→github.com · `Netflix`→netflix.com
  - contains: `· GitHub`→github.com · `: r/`→reddit.com · `Instagram`→instagram.com · `ChatGPT`→chatgpt.com · `WhatsApp`→web.whatsapp.com

### 9.4 Categorization (`core/categorize.ts`, ADR-0005)
- **Precedence:** title rule > domain rule > app rule. Within a type, user rules (`is_default=0`) beat defaults, and then the longest pattern wins. No match → `uncategorized`.
- **Domain rules** match when `domain === pattern` or `domain.endsWith('.' + pattern)`.
- **A browser row with `domain = null`** → `neutral`.
- Default rules:
  - **Productive apps:** code.exe, cursor.exe, devenv.exe, idea64.exe, pycharm64.exe, webstorm64.exe, windowsterminal.exe, powershell.exe, pwsh.exe, cmd.exe, winword.exe, excel.exe, powerpnt.exe, onenote.exe, notion.exe, obsidian.exe, figma.exe, notepad.exe, notepad++.exe
  - **Neutral apps:** outlook.exe, olk.exe, ms-teams.exe, teams.exe, zoom.exe, slack.exe, explorer.exe, chrome.exe, firefox.exe, msedge.exe, spotify.exe, discord.exe, whatsapp.exe, applicationframehost.exe
  - **Distracting apps:** steam.exe, epicgameslauncher.exe, battle.net.exe
  - **Productive domains:** github.com, gitlab.com, stackoverflow.com, docs.google.com, notion.so, figma.com, developer.mozilla.org, learn.microsoft.com, vercel.com, linear.app, atlassian.net, trello.com
  - **Neutral domains:** mail.google.com, outlook.office.com, outlook.live.com, calendar.google.com, meet.google.com, zoom.us, slack.com, teams.microsoft.com, google.com, bing.com, wikipedia.org, linkedin.com, chatgpt.com, claude.ai, browser-internal, web.whatsapp.com
  - **Distracting domains:** youtube.com, netflix.com, primevideo.com, hotstar.com, twitch.tv, reddit.com, x.com, twitter.com, facebook.com, instagram.com, tiktok.com, 9gag.com

## 10. Aggregation spec: `src/core/aggregate.ts` (P25–P27, P30)
`daySummary(date, data, rules, settings)`. All intervals are clipped to the local day `[00:00, 24:00)`.

**Totals:**
- `scheduledSec`: the work window length (after overrides); 0 on a day off.
- `workSec` = Σ segments of non-break sessions + Σ away periods classified `meeting` or `offline_work`.
- `breakSec` = Σ break segments + Σ away classified `break`.
- `notWorkingSec`, `awayPendingSec`: from the away periods.
- `distractingSec` = Σ overlap(activity categorized distracting, non-break segments).
- `productiveSec = workSec − distractingSec`.
- `score = scheduledSec > 0 ? productiveSec / scheduledSec : null`.
- `goalMet = productiveSec ≥ goalSec`.

**App/site table** (scope = work window if `appPercentScope = 'work_hours'` and the day has a window, otherwise the whole day):
- Grouping key: `domain` if set; `Firefox: <title>` for an unmatched Firefox row; `Private browsing` for private rows; otherwise `appName`.
- Each row is `{key, sec, pct = sec / Σsec × 100, category}`. Percentages sum to 100 ± 0.1.

**Also returned:**
- `categoryTotals` (for the donut)
- sessions list: name, project, kind, start, end, elapsed, planned, overtime, delta
- away list
- distraction flags
- `offHoursActivitySec`
- unlabelled session count

**Streak** (`streaks.ts`): walk back from today.
- A scheduled day with `goalMet` → count + 1.
- Today, not yet met → skip it.
- Any other scheduled day not met → stop.
- Unscheduled days are skipped.
- Cap at 366.

## 11. IPC contract (`src/preload/index.ts` → `window.spyder`; channels are named `spyder:<method>`)
- **Engine:** `getWidget(): WidgetVM` · `onWidget(cb)` · `start(input)` → `{ok} | {error:'needs_label', sessionId}` · `done()` · `extend(sec)` · `pause()` · `resume()` · `label(sessionId, name, projectId)` · `keepWorking()`
- **Prompts:** `getPrompt(): PromptVM | null` · `onPrompt(cb)` · `answer(promptId, answer)`
- **Data:** `nameSuggestions(prefix)` · `listProjects()` · `saveProject(p)` · `getDay(date)` · `getRange(from, to)` · `listUncategorized(date)` · `listRules()` · `saveRule(r)` · `deleteRule(id)` · `listTitlePatterns()` · `saveTitlePattern(p)` · `deleteTitlePattern(id)`
- **Review:** `getReview(date)` · `saveReviewItem(item)` · `deleteReviewItem(id)` · `completeReview(date)` · `listKpis()` · `saveKpi(k)` · `setKpiValue(date, kpiId, value)`
- **Settings:** `getSettings()` · `setSettings(partial)` · `getSchedule()` · `setSchedule(rows)` · `setDayOverride(date, o | null)`
- **Export:** `exportData({from, to, xlsxPath?, csvDir?})` (a save dialog opens if no path is given)
- **Windows:** `hideWidget()` · `openDashboard(route)`
- **Debug** (only registered when `SPYDER_DEBUG=1`): `debug.state()` · `debug.setNow(ms)` · `debug.advance(sec)` · `debug.simulateIdle(lastInputMs)` · `debug.simulateSuspend()` · `debug.simulateResume()` · `debug.simulateLock()` · `debug.simulateUnlock()` · `debug.injectActivity(sample)` · `debug.trayInfo()` · `debug.flush()`
- **Clock** (`core/clock.ts`): `now() = origin + (Date.now() − realOrigin) × scale + offset`. `origin` comes from `SPYDER_NOW` (ISO local time) or `Date.now()`; `scale` from `SPYDER_CLOCK_SCALE` (default 1). `setNow` and `advance` change `offset`.

## 12. UI spec
Visuals (colors, type, spacing, exact widget anatomy) come from `design/DESIGN.md` (Phase 0). Behavior comes from here.

**Windows:**
- **widget**: frameless, transparent, always on top (`setAlwaysOnTop(true, 'floating')`), `skipTaskbar`, not resizable, size per DESIGN.md. Position is saved on `moved` (debounced 500 ms).
- **prompt**: frameless, always on top, ~420×auto. Placed below the widget if it fits, else centered. It takes focus when shown.
- **dashboard**: framed window, 1200×800 (min 960×640), sidebar with Today / Week / Month / Review / Rules / Settings.
- **tray**: tooltip `Spyder — {title} {timer}`. Menu: Show widget · Open dashboard · Start session… · Pause/Resume · Quit.
- **hotkey**: toggles the widget.
- Closing the dashboard hides it. Only Quit exits.

**Widget contents (collapsed):**
- session title
- timer (red with a `+` in overtime)
- a thin workday-% bar with a `62% of day` label
- today's productive time / goal
- the whole widget is tinted red when `isDistracted`

Expanded (click): Start · Done · +5 · +15 · Pause/Resume · Break · Open dashboard · Style toggle (Full/Compact, P31) · Hide (×).

**Compact style** (P31): timer + caps caption + workday ring only; the title, workday % and productive/goal appear in a hover card. Every collapsed-widget item above must still be reachable.

**Start-session popover** (opens in the prompt window):
- Tabs: Planned / Timed / Open / Break.
- Name field with autocomplete (`nameSuggestions`); project dropdown with "+ New project".
- Duration presets 15/25/30/45/60/90 plus custom.
- Direction toggle ↑/↓ (planned only), defaulting to `defaultDirection`.
- If `start` returns `needs_label`, the popover first shows "What were you doing for the last {elapsed}?".

**Prompt copy** (use these strings exactly):
- `timeUp`: **"Time's up: {name}"** — "Planned {planned}. Done, or need more time?" [Done] [+5 min] [+15 min] [Custom…] [Switch task]
- `label`: **"What did you do for the last {elapsed}?"** — name + project. [Save]. In the review only: [Mark as Unknown].
- `checkIn` (unlabelled): **"What have you been doing for the last {elapsed}?"** [Log & continue] [Log & start fresh]
- `checkIn` (labelled): **"Still on {name}?"** [Yes, still on it] [Log & start fresh] [Change label]
- `away`: **"You were away {duration}"** ({start}–{end}) [Break] [Meeting / call] [Offline work…] [Not working] [I was working]
- `recovery`: **"Spyder wasn't running from {start} to {end}"**, with the same buttons as `away`.
- `breakEnd`: **"Break's over ({planned})"** [Back to work] [+5 min]

**Ring:** a 3-note chime (WebAudio oscillator, ~1 s) played by the widget renderer when it receives a `ring` event.

**Dashboard pages:**
- **Today:** stat header (work time, productive time / goal ring, day score, streak, distractions), timeline (§10), sessions table, apps/sites table (`key · h:mm · pct%` plus a category chip that changes category in one click by creating a user rule), category donut, flags list, off-hours note.
  - Uses Recharts PieChart (donut). The timeline is custom SVG.
- **Week:** stacked bars per day by category (Recharts BarChart), goal-hit markers, top 10 sites, estimate accuracy (planned vs actual table).
- **Month:** calendar heatmap of productive hours (custom SVG grid), trend lines (LineChart) for productive time and score, KPI line charts.
- **Review:** label leftover sessions and pending away periods (the [Complete review] button stays disabled until there are none), a day summary, "Today's wins" and "How I'll improve" bullet editors (Enter adds, drag to reorder), KPI number inputs. [Complete review] writes the `reviews` snapshot.
- **Rules:** tables for rules and title patterns (add/edit/delete), an Uncategorized inbox, projects editor, KPI definitions.
- **Settings:** schedule grid (7 rows: enabled, start, end), today override, every key in §5, hotkey warning, data folder path, [Export…].

## 13. Phases
Each phase lists **Build**, **Verify** (everything must pass) and **Commit**. Shared e2e helper (`tests/e2e/helpers.ts`):
- `launch({now, scale, dataDir})` builds the env (`SPYDER_DEBUG=1`, `SPYDER_DATA_DIR=<fresh tmp dir>`, `SPYDER_NOW`, `SPYDER_CLOCK_SCALE`) and launches `out/main/index.js`.
- It returns `{app, widget, prompt, dashboard, debug}`. Windows are found by URL hash.
- Default `now`: `'2026-11-24T11:00:00'` (a Tuesday, inside work hours).

### Phase 0: Setup and design reference
**Already done:** folder moved to `C:\Users\rexon\spyder`, `git init`, plan committed, ADRs, `docs/product-decisions.md`, `CONTEXT.md`.

**Build:**
- `.gitignore` (node_modules, out, dist, release, coverage, tests/e2e/__shots__, *.db, *.db-wal, *.db-shm, resources/UrlHelper.exe) and `.gitattributes`.
- **Rize UI research:** find real images of Rize's **desktop widget / floating timer**, session timer, dashboard, timeline and reports. Sources:
  - rize.io pages (homepage, /features/*): scrape the `<img>` and `srcset` URLs
  - docs.rize.io articles (desktop-widget, sessions, focus)
  - the Product Hunt gallery (producthunt.com/products/rizeio)
  - Microsoft Store and Mac App Store listings
  - review blogs and YouTube thumbnails (`img.youtube.com/vi/<id>/maxresdefault.jpg`)
- Download them with `curl -L` into `design/reference/`, then **open each one with Read** and note what it shows in `design/reference/INDEX.md`.
- If no clear image of the widget is found, ask the user for their screenshot. They have a low-res one.
- Write `design/DESIGN.md`:
  - color tokens (background, surface, text, muted, accent, red/overtime, category colors: productive, neutral, distracting, uncategorized, break, away)
  - font and type scale; radii; spacing; shadows
  - **widget anatomy** (collapsed and expanded, with pixel sizes)
  - prompt window layout
  - dashboard layout (sidebar width, card grid)
  - chart styling
  - Rule: **no Rize logo, name or brand marks** (P23)

**Verify:**
- `design/reference/` has at least 3 images, at least one showing the widget or timer clearly (or the user's screenshot). Each has been viewed and described in INDEX.md.
- DESIGN.md covers the widget, prompt, start popover, the 6 dashboard pages and charts.
- **Show the user** a short design summary (tokens and widget sketch as text) and get a go-ahead with AskUserQuestion.

**Commit:** `chore: phase 0 — setup and design reference`

### Phase 1: Scaffold
**Build:**
- package.json with the dependencies from §2 and these scripts:
  - `dev`: `electron-vite dev`
  - `build`: `electron-vite build`
  - `typecheck`: `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`
  - `lint`: `eslint .`
  - `test`: `vitest run`
  - `test:cov`: `vitest run --coverage`
  - `test:e2e`: `npm run build && playwright test`
  - `db:dump`: `tsx scripts/db-dump.ts`
  - `seed`: `tsx scripts/seed.ts`
  - `build:helper`: `powershell -ExecutionPolicy Bypass -File scripts/build-helper.ps1`
  - `icon`: `powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1`
  - `dist`: `npm run build:helper && npm run build && electron-builder --win nsis`
- `electron.vite.config.ts`: main, preload and renderer (React and Tailwind plugins), with the externals from §3.
- Tailwind v4: `@import "tailwindcss";` plus an `@theme` block with the DESIGN.md tokens.
- `src/main/main.ts`: setName, AppUserModelId, single-instance lock (a second launch focuses the widget), data dir, DB open + migrate + seedDefaults, create the widget and a hidden dashboard, tray, hotkey.
- `src/core/clock.ts` (§11).
- `src/main/debug.ts` (empty hooks registered only when `SPYDER_DEBUG=1`), plus `debug.state()` and `debug.trayInfo()`.
- `scripts/make-icon.ps1`: System.Drawing, a 256×256 PNG (accent circle with a white "S") → `resources/icon.png`. Use the PNG for the tray, and let electron-builder produce the .ico.
- `scripts/db-dump.ts`: prints the row count for each table, plus the last 20 rows of sessions, segments, away_periods and activity (path from `SPYDER_DATA_DIR` or `%APPDATA%\Spyder`).
- `playwright.config.ts` (testDir `tests/e2e`, workers 1, timeout 60 s).
- `vitest.config.ts` (include `src/core/**/*.test.ts`, coverage on `src/core`).

**Verify:**
- `npm run typecheck`, `npm run lint` and `npm test` all pass. Add one trivial clock test so Vitest has something to run.
- In the Electron main process, `require('node:sqlite')` works. Log `process.versions.node` at startup and check it's ≥ 22.13. If not, apply the ADR-0003 fallback and record it.
- `tests/e2e/smoke.spec.ts`:
  - widget and dashboard windows exist
  - `debug.trayInfo()` reports a tray
  - every table from §6 exists in the temp DB
  - default schedule, settings, rules and title patterns are seeded
  - screenshots `smoke-widget.png` and `smoke-dashboard.png` are saved and **viewed**
- Launching the app a second time (`npm run dev` twice) leaves one instance.

**Commit:** `feat: phase 1 — scaffold`

### Phase 2: Core engine (pure logic)
**Build:** `schedule.ts` (`window`, `inWork`, `workdayPct`, `nextBoundary`), `sessionEngine.ts` (§7, every rule E1–E19), `widgetView`, `nudge.ts` (§8), `format.ts` (h:mm, mm:ss, durations).

**Verify:** `npm run test:cov` with these Vitest scenarios. Each one drives `reduce` with explicit `ctx.now` values and asserts the state, DB effects and prompts.
1. A planned 30-min countdown "Replying to emails": ring at 30:00 plus `timeUp`. No answer → re-nag (ring) at +5 and +10 min. Overtime is shown. EXTEND 900 clears the prompt. DONE stores `overtime_sec`.
2. A planned count-up: the display counts up, and it still rings at the planned time.
3. Timed 10 min → `label` prompt. Answering it labels the session, and an open session follows.
4. An open session gets `checkIn` at 30 and 60 min. `continue` keeps the same session id. `fresh` closes it and starts a new one. `still` only resets the timer.
5. DONE on an unlabelled open session queues `label` and immediately starts a new open session.
6. START while the current session is unlabelled → `needs_label`. After LABEL, START succeeds and the old session ends as `switched`.
7. PAUSE → a break runs. RESUME continues the same session, and the countdown remaining equals the remaining time before the pause.
8. A TICK at 10:00 (off hours → working) auto-starts an open session. BOOT at 11:00 with no heartbeat starts one.
9. Idle: AWAY_BEGIN at 11:20 and AWAY_END at 12:32 → an away period of 72 min, the segment is cut at 11:20, the `away` prompt is queued, and the session resumes at 12:32. Each of the 5 classifications is stored. `working` adds a segment, and `elapsed_sec` grows by 72 min.
10. A lock of 30 s (under `shortAwayIgnoreSec`) records no away period.
11. AWAY_BEGIN during a break is ignored (P18).
12. Suspend from 16:30 to 18:00 (day ends 17:00): away is recorded as `[16:30, 17:00]`, the session closes at 16:30, mode is off_hours, and `openReview` is emitted.
13. TICK at 17:00 while working: the session is cut at 17:00 (`work_hours_end`) and `openReview` is emitted once. KEEP_WORKING sets the override to 17:30 and an open session starts.
14. BOOT with a heartbeat from 40 min ago in working mode → a `recovery` prompt for `[hb, now]`. A heartbeat from 30 s ago → seamless resume.
15. Prompt queue: an away prompt jumps ahead of a check-in, and duplicate check-ins are not queued.
16. An open session capped at 24 h.
17. `workdayPct` at 10:00 → 0, at 13:30 → 50, at 17:00 → 100, at 09:00 → 0, at 18:00 → 100, on a day off → 0.
18. Nudge: 5 min of distracting → nudge. Another 5 min → a second nudge. A 30 s switch away doesn't reset it. A 60 s switch away does. Not in a work session → never.

Coverage of `src/core` must be at least **90 %** lines and branches.

**Commit:** `feat: phase 2 — session engine`

### Phase 3: Widget, tray, prompts and live engine
**Build:**
- `engineHost.ts`: holds the state, TICK every 1 s (real) using clock time, applies effects to the DB via `repo.ts`, pushes `onWidget`/`onPrompt`, heartbeat every 15 s, BOOT on startup.
- `idle.ts`:
  - poll `getSystemIdleTime()` every 5 s; when it reaches the threshold → `AWAY_BEGIN{atMs: now − idle×1000, reason:'idle'}`
  - input resumes → `AWAY_END`
  - `suspend`, `lock-screen` → AWAY_BEGIN; `resume`, `unlock-screen` → AWAY_END
- Widget UI, prompt window, start popover, ring, tray menu, hotkey and position persistence (§12), styled per DESIGN.md.

**Verify:** e2e `widget.spec.ts` with `scale: 600` (one real second = 10 clock minutes). Use debug hooks where real time would be too slow:
1. Start planned "Replying to emails", 30 min, countdown. Within about 4 s the `timeUp` prompt is visible. Wait 1 s more and the widget shows red `+` overtime (screenshot). `debug.advance(300)` → ring count increased (expose a ring counter in `debug.state()`). Click +15 → the prompt closes and the timer counts down again.
2. Timed 10 min → `label` prompt → enter "Inbox zero" → the DB session has that name and the kind is timed.
3. Leave an open session for 30 clock-min → `checkIn` prompt (screenshot) → [Log & continue] with "Planning".
4. `debug.simulateSuspend()`, `debug.advance(4320)`, `debug.simulateResume()` → the away prompt shows "You were away 1h 12m" (screenshot) → [Break] → the `away_periods` row has classification `break`.
5. Kill the app process, relaunch with the same data dir and `SPYDER_NOW` 40 min later → `recovery` prompt.
6. Drag the widget (move via `app.evaluate` with `BrowserWindow.setPosition`) and relaunch → same position. `hideWidget()` → hidden. Trigger the hotkey handler via a debug hook → visible.
7. Screenshots of: the collapsed widget, the expanded widget, overtime, distracted (`debug.injectActivity` youtube.com in a session for 5 clock-min), each prompt type, and the start popover. **View every one** against DESIGN.md.
8. **Manual, by the user** (ask them, then log the answer): with `npm run dev`, a real 1-min planned session rings audibly and the prompt appears.

**Commit:** `feat: phase 3 — widget and prompts`

### Phase 4: Activity tracking and categorization
**Build:** §9 in full. That means `foreground.ts` + `foregroundProbe.ts`, `UrlHelper.cs` + `build-helper.ps1`, `chromeUrl.ts`, `core/url.ts`, `firefoxTitle.ts` + `core/titlePatterns.ts`, `core/merge.ts`, `core/categorize.ts`, tracker loop, batching, the nudge wired to toasts, and flags.

**Verify:**
- Unit tests:
  - URL parsing (with and without scheme, `www.`, search text, `chrome://`)
  - Firefox title parsing: YouTube, Gmail, GitHub (prefix and contains), Reddit `: r/`, X `/ X`, private window, bare "Mozilla Firefox", unknown title
  - categorize precedence (title > domain > app; user beats default; longest wins; subdomain match `m.youtube.com`)
  - merge (same key extends, a gap > 2×interval+1 s splits, a title change splits, rows < 1 s dropped)
- `npm run build:helper` produces `resources/UrlHelper.exe`. Running it with `ping` returns `{"ok":true}`.
- `scripts/capture-check.ts` (runs against the dev app with `SPYDER_DEBUG=1`):
  - open Notepad, then Chrome at `https://example.com` (`Start-Process chrome https://example.com`), then Firefox at `https://www.youtube.com`
  - focus each for 10 s (PowerShell `(New-Object -ComObject WScript.Shell).AppActivate(<pid>)`), then `debug.flush()`
  - `db:dump` shows activity rows `notepad.exe`, `chrome.exe` with domain `example.com`, and `firefox.exe` with domain `youtube.com`, each 8–12 s long
- Helper latency: 50 `fg` calls with Chrome in front → p95 < 150 ms. Log the numbers.
- A screenshot of the nudge toast and red widget, from real capture or `injectActivity`.
- `scripts/soak.ts`: run the app for 10 min with the user idle → average CPU < 2 % and working-set growth < 30 MB (sampled via `Get-Process`). Log the numbers.

**Commit:** `feat: phase 4 — activity tracking`

### Phase 5: Daily report and end-of-day review
**Build:** `core/aggregate.ts` (§10), the dashboard shell, Today page, Review page (§12), and `scripts/seed.ts --days N` (realistic days: planned, timed and open sessions, breaks, one away period of each classification, Chrome and Firefox activity including YouTube, one overtime, one distraction flag, wins/improve/KPI values).

**Verify:**
- Aggregate unit tests on a hand-built fixture day with the expected numbers written in the test: workSec, breakSec, distractingSec, productiveSec, score, goalMet; app percentages sum to 100 ± 0.1; midnight-crossing split; off-hours activity excluded from the work-hours scope.
- e2e `today.spec.ts`: `seed --days 1` into the temp dir, open Today, read every number on the stat header and the top 5 app rows from the DOM, and assert they equal `aggregate()` computed in the test from the same DB.
- Change a category via the chip → the Distracting total changes and a user rule exists.
- e2e `review.spec.ts`:
  - `debug.setNow` to 17:00:05 → the dashboard opens on Review
  - [Complete review] is disabled while an unlabelled session exists; label it → enabled
  - add a win, an improvement and a KPI value → reload → they persist
  - completing writes the `reviews` row
- Screenshots of Today and Review are **viewed**.

**Commit:** `feat: phase 5 — daily report and review`

### Phase 6: Weekly and monthly views, streaks, rules and settings
**Build:** Week and Month pages, `streaks.ts`, Rules page (rules, title patterns, Uncategorized inbox, projects, KPIs), Settings page (all of §5, schedule, override, hotkey warning). Settings changes apply live (engine `SCHEDULE_CHANGED`, tracker reads its settings each tick).

**Verify:**
- Streak unit tests: 5 met days → 5; a weekend in between doesn't break it; a missed Wednesday breaks it; today not yet met → it isn't counted and nothing breaks.
- `seed --days 60` → the Week and Month pages render (screenshots viewed). The week bars' totals equal `daySummary` sums.
- Adding the title pattern `contains "Hacker News" → news.ycombinator.com` re-labels existing Firefox rows in reports.
- e2e: change idle threshold to 1 min → `simulateIdle` 70 s ago triggers away. Change check-in to 10 min → the prompt comes at 10 clock-min. Disable today in the schedule → the widget shows Off hours.

**Commit:** `feat: phase 6 — trends, rules, settings`

### Phase 7: Export
**Build:** `export.ts` with exceljs. Sheets: **Sessions** (date, start, end, kind, name, project, planned min, actual min, overtime min, end reason) · **Segments** · **Activity** (date, start, end, app, exe, domain, title, category, minutes) · **App-Site summary** (key, category, minutes, h:mm, %) · **Daily summary** (date, scheduled, work, productive, break, distracting, score, goal met, streak) · **Away** · **Reviews** (date, wins, improvements joined with " • ") · **KPIs** (date × KPI columns).
- Bold, frozen header rows; sensible column widths; dates as real Excel dates; durations in both minutes (number) and h:mm (text).
- CSV: one file per sheet, UTF-8 with BOM, RFC 4180 quoting, and cells starting with `= + - @` prefixed with `'`.
- The dialog has presets: Today, This week, This month, Last 30 days, Custom.

**Verify:**
- An integration test seeds 14 days, exports to a temp folder, re-opens the xlsx with exceljs and asserts: all 8 sheet names, the header rows, and Sessions/Activity row counts equal to the DB counts in range. Each day's Daily summary minutes must equal `daySummary`.
- The CSVs parse back to the same rows. A session named `=cmd|' /C calc'!A0` is escaped. An emoji or non-Latin title survives the round trip.
- **Manual, by the user:** open the xlsx in Excel and confirm it looks neat. Log the answer.

**Commit:** `feat: phase 7 — export`

### Phase 8: Packaging and acceptance
**Build:**
- electron-builder config: appId `com.spyder.app`, productName `Spyder`, NSIS one-click per-user, icon, `extraResources` with UrlHelper.exe, `asarUnpack` `**/*.node`.
- `NOTICE` with the OpenTime (Apache-2.0) attribution.
- `app.setLoginItemSettings({openAtLogin: settings.autostart})`.
- Debug hooks are excluded unless `SPYDER_DEBUG=1`. Verify `debug.*` is undefined in the packaged app.

**Verify:**
- `npm run dist` → an installer in `release/`. Silent install (`/S`), launch the installed exe, and the widget appears.
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has a Spyder entry.
- Uninstall (`/S`) leaves `%APPDATA%\Spyder\spyder.db` in place.
- The full `npm test` and `npm run test:e2e` pass. The smoke e2e also runs against the installed exe.
- **User acceptance (manual, one real workday; ask the user and log results):**
  - real sleep/wake gives the away prompt
  - YouTube in Chrome and in Firefox shows correct minutes
  - the 5-min nudge fires
  - the review opens at 17:00
  - the export opens neatly in Excel
  - the widget looks and feels right

**Commit:** `chore: phase 8 — packaging`

## 14. Progress log
_(append one entry per phase: date · phase · verification results with numbers · deviations, and which decisions were added to docs/product-decisions.md or docs/adr/)_

**2026-11-21 · Phase 0 · done.**
- `.gitignore`, `.gitattributes` added.
- Design references: 5 images in `design/reference/` (sources: rize.io homepage app shot, rize.io S3 changelog/OG assets, Webflow CDN feature images), each viewed and described in `INDEX.md`. The **widget is clearly shown** in `rize-widget_meeting_dark.png` (official states sheet). No usable images from docs.rize.io (redirects/no imgs); feature subpages like `/features/desktop-widget` 404 on the current site. Did not need the user's screenshot.
- `design/DESIGN.md` written: tokens, type, widget (full + compact), prompt, start popover, 6 dashboard pages, charts, tray.
- User design review: asked to **build both widget styles, switchable any time** → added **P31** and the `widgetStyle` setting (§5, §12).

**2026-11-21 · Phase 1 · done.**
- Resolved versions: electron 45.4.1 (Node 24.22.3), electron-vite 6.0.0, vite 8.3.8, @vitejs/plugin-react 6.3.0, typescript 6.0.3, react 19.3.1, zustand 5.1.0, date-fns 4.4.0, recharts 3.11.0, exceljs 4.4.0, @miniben90/x-win 3.7.0, tailwindcss 4.3.5, vitest 4.1.12, @playwright/test 1.65.1, eslint 10.15.0, typescript-eslint 8.73.0, eslint-plugin-react-hooks 7.1.1, electron-builder 26.18.0, tsx 4.23.15.
- Deviation: `@types/node` pinned to `^24` (npm resolved 14.x, which broke vite's peer range); 24 matches Electron's Node.
- `node:sqlite` works in the Electron main process (Node 24.22.3 ≥ 22.13) → no ADR-0003 fallback.
- Playwright `_electron.launch()` attaches to Electron 45 fine → CDP fallback not needed.
- typecheck ✓, lint ✓ (core purity enforced by `no-restricted-imports` + `Date.now` ban in eslint), `npm test` 3/3 ✓, smoke e2e 5/5 ✓ (windows, tray menu, 17 tables, seeded schedule/settings/78 rules/25 title patterns); screenshots `smoke-widget.png`, `smoke-dashboard.png` viewed.
- Single instance: second launch with the same data dir exits (code 0, ~1 s) without booting. Checked with the built app (`electron out/main/index.js` ×2); `npm run dev` uses the same lock.
- Notes: `userData` is set to `<dataDir>/electron` so test instances are isolated from the real app. Migrations are loaded via Vite `?raw` in the app and `loadMigrationsFromDisk()` for tsx scripts.

**2026-11-21 · Phase 2 · done.**
- `src/core`: `types.ts`, `schedule.ts` (window/inWork/workdayPct/nextBoundary + `mergeOverride`), `sessionEngine.ts` (E1–E19, `widgetView`, `visiblePrompt`, `inWorkSession`), `nudge.ts`, `format.ts`; test harness `engine.testkit.ts` (excluded from coverage).
- `npm run test:cov`: 65 tests pass (all 18 plan scenarios + edge cases). Coverage of src/core: lines 97.86 %, branches 95.62 %, statements 97.14 %, functions 96.38 %.
- Spec interpretations (recorded): **P32** (overrides extend, never shrink), **P33** (away across the day end closes the old session, no cross-day resume), **P34** (labelling a timed session after time-up ends it, which scenario 3 needs).
- Other engine details: prompt dedupe key is (type, sessionId, awayId) so two separate away periods both queue; prompts carry `awayStartMs/awayEndMs`; `saveHeartbeat` is also emitted on every mode change (so a crash in away/off-hours restores correctly); START rejects with `needs_label` if the *paused* session is unlabelled too; host must recompute `sessions.elapsed_sec` from segments on `insertSegment` for sessions no longer in engine state.

**2026-11-22 · Phase 3 · done.**
- Main: `engineHost.ts` (state, tick loop, effects → `db/repo.ts`, ring counter, day overrides via `mergeOverride`, heartbeat saved after every effect-producing event, widget/prompt push on change, tray tooltip), `idle.ts` (5 s idle poll, suspend/lock/resume/unlock), `notify.ts` (toast), prompt window + widget layouts in `windows.ts`, engine/prompt/data IPC. Core additions: `promptView.ts` (exact §12 copy), `categorize.ts` (§9.4, pulled forward from Phase 4 so `debug.injectActivity` can drive the nudge), `clock.setScale`.
- Renderer: Full + Compact widget (progress stroke, workday ring, prompt dot, distracted/overtime/paused/away/off-hours states, compact hover card, expanded panel with ⇄ style toggle), prompt card for all 6 types, start popover (tabs, autocomplete, project + "New project", presets/custom, direction, needs-label step), WebAudio 3-note ring.
- Verify: typecheck ✓, lint ✓, unit 72/72 ✓ (core coverage lines 99.3 %, branches 94.6 %), e2e 13/13 ✓ (`widget.spec.ts` items 1–7 + smoke). All 22 screenshots viewed against DESIGN.md. **Manual (user, 2026-11-22):** `npm run dev`, 1-min planned session → chime audible and the Time's up prompt appeared ✓.
- Deviations / test support:
  - Tick runs every `max(50, 1000/scale)` ms of real time when the clock is sped up (1 s at scale 1), so timers stay accurate at scale 600.
  - Extra debug hooks `setScale` and `tick`. Scenario 1 slows the clock to scale 1 once the Time's up prompt shows; at scale 600, "+15" could never end the overtime (the ~20 clock-min of overtime would already exceed it).
  - `SPYDER_FAKE_IDLE=1` (set by the e2e helper) makes the real idle source report 0, so the machine's own idleness can't disturb tests.
  - Widget position is saved on `move` (debounced 500 ms), not `moved`: on Windows `moved` doesn't fire for programmatic moves.
  - Full pill caption is two caps lines (`62% OF DAY` / `2:14 / 5:00 PRODUCTIVE`); one line didn't fit 320 px. Keep working +30 is in the expanded panel (and the compact hover card) instead of a hover chip inside the pill, which sat under the click target.
  - Widget "productive today" is work-session time today for now; subtracting distracting time (P25) comes with `aggregate.ts` in Phase 5.

**2026-11-22 · Phase 4 · done.**
- Core: `url.ts` (omnibox → domain, typing reuse per hwnd+title), `titlePatterns.ts` (Firefox suffix strip, private, new tab, longest pattern), `merge.ts` (key exe/domain/title/private, 2×interval+1 s gap, end = min(last+interval, next), < 1 s dropped). Main: `capture/foregroundProbe.ts` (utility process, separate Vite entry), `foreground.ts` (1/2/4/8/16 s backoff, 5 restarts per 10 min), `chromeUrl.ts` (one request in flight, 800 ms timeout, late replies dropped), `firefoxTitle.ts`, `tracker.ts` (samples every `sampleIntervalSec` of real time, skips and flushes on away/idle capped at the last input, 30 s batches, flush on quit, feeds the nudge). `src/native/UrlHelper.cs` + `scripts/build-helper.ps1`.
- Verify: typecheck ✓, lint ✓, unit 106/106 ✓ (core lines 99.0 %, branches 93.9 %), e2e 13/13 ✓. `npm run build:helper` → `resources/UrlHelper.exe`, `ping` → `{"ok":true}` ✓.
- `scripts/capture-check.ts` (hands-off run): notepad.exe 12.05 s, chrome.exe example.com 10.0 s, firefox.exe youtube.com 10.2 s. Notepad was 0.05 s over because it was already in front ~2 s before its focus window. The script now counts from the start of the focus loop (not re-run). Earlier runs failed only because the user was working in Zed during them.
- Helper latency, 50 `fg` calls with Chrome in front: p50 0.3 ms, p95 0.6 ms, max 171 ms (first call finds the omnibox; then it's cached) ✓.
- `scripts/soak.ts`, 10.3 min, real capture, 322 samples: average CPU 0.07 % of the machine (1.42 % of one core) ✓. Working set 522 → 104 MB ✓, but Windows trimmed it at ~3 and ~9 min; between trims it went 77 → 133 MB and then dropped. Not a clear leak, but not strong proof either.
- Probe crash: `debug.killProbe` → restarted within the 1 s backoff, sampling resumed ✓.
- Nudge: red widget captured on the real desktop (`scripts/nudge-shot.ts`, cropped to the widget) and in `widget-full-distracted.png` ✓. The toast didn't pop up on screen, but the **user confirmed it is in the notification centre** (2026-11-22). Windows also logged it under `com.spyder.app`. The pop-up was probably suppressed by Do Not Disturb or full-screen rules. Check again with the installed app in Phase 8.
- Deviations / decisions:
  - **P35:** title suffix `YouTube` → youtube.com (the home page's title is just "YouTube").
  - The probe reads `w.title` / `w.info` instead of `toObject()`: 5× cheaper, because `toObject()` also loads the icon.
  - Dev/test helper path is `out/main/../../resources/UrlHelper.exe`. `app.getAppPath()` is wrong when launched as `electron out/main/index.js`.
  - `SPYDER_CAPTURE=0` (set by the e2e helper) turns the real tracker off so the foreground window can't disturb tests. New debug hook `killProbe`. `debug.flush` now also flushes the tracker.
  - "Capture unavailable" is exposed in `debug.state().tracker`. The Settings banner comes with the Settings page in Phase 6.
  - Default title patterns are only seeded into an empty table, so an existing dev DB doesn't get P35's pattern.
  - From the Bash tool, the Store version of Notepad won't launch. Run `capture-check` from PowerShell.
