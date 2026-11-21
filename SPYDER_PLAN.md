# SPYDER_PLAN.md: Spyder, a personal accountability time tracker for Windows

> **On approval:** create `C:\Users\rexon\spyder\`, move `temp.md` there from `C:\Users\rexon\OneDrive\Desktop\spyder\` (then delete the empty OneDrive folder), and save this plan as `C:\Users\rexon\spyder\SPYDER_PLAN.md`. Then run `git init` and make commit `chore: add plan`. The user continues in a new Claude Code session opened in `C:\Users\rexon\spyder`.

## How to execute this plan (rules for the implementing agent)
1. Work **one phase at a time, in order**. Do not start phase N+1 until every verification item in phase N passes.
2. After each phase: run its verification steps and **look at the screenshots yourself** (Read the PNGs). Fix anything that fails, then append an entry to the **Progress log** at the bottom (date, what was verified, any deviations). Commit with the phase's commit message. Local git only, never push.
3. Ask the user (AskUserQuestion) whenever a decision isn't covered here. Don't guess on product behavior.
4. Keep `src/core/` pure (no Electron, no I/O, injected clock) so that all timing logic is unit-testable.
5. Every time-based behavior must be testable fast. Use the injectable `Clock` and the dev env var `SPYDER_CLOCK_SCALE` (e.g. `600` makes 30 min take 3 s). Debug IPC hooks such as `debug:simulateIdle`, `debug:simulateSuspend`/`Resume`, `debug:setNow` and `debug:injectActivity` are compiled in only when `SPYDER_DEBUG=1`.

## Context
Spyder is a personal Windows app that holds you accountable for your time. It has a floating Rize-style timer widget. Every minute of your work hours belongs to a labelled session. Away and sleep time is accounted for. The foreground app and website are tracked so the data can't be gamed. It has daily, weekly and monthly reports and spreadsheet export. **No AI.**

Prior-art check (Nov 2026): ActivityWatch, OpenTime, Dayflow (Mac) and its Windows port, rize-local-public and VibeFriend. None has this session- and accountability-first model on Windows. **Decision: build from scratch**, reusing ideas and code from **OpenTime** (github.com/ElectricGamer61/OpenTime, Apache-2.0; add attribution in `NOTICE`):
- `@miniben90/x-win` foreground-window capture, probed in a child process (`src/main/capture/index.ts`)
- the Chrome address-bar UI Automation helper protocol (`src/main/capture/addressBar.ts`, `src/native/address-helper`)
- idle handling via `powerMonitor` (`src/main/tracker.ts`)

## Environment facts (checked 2026-11-21)
Node v25.9.0, npm 11.5.2, git 2.44 and Python 3.13 are installed. **No .NET SDK.** The built-in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` and `...\WPF\UIAutomationClient.dll` exist, so the Chrome URL helper targets .NET Framework 4.x and is compiled with the built-in csc.exe. Browsers: Chrome and Firefox.

## Stack
Electron (latest stable) + electron-vite + React + TypeScript (strict) + Tailwind · better-sqlite3 (rebuilt for Electron via @electron/rebuild) · Recharts · exceljs · Vitest (unit) · Playwright `_electron` (e2e and screenshots) · electron-builder (NSIS) · ESLint and Prettier. Data lives in `%APPDATA%\Spyder\spyder.db`.

## Product spec (settled with the user)

**Sessions: always-on during work hours.** No untracked work time. On work-hours start, app launch during hours, or return from away, an *open* session starts automatically.

| Type | Start | Running | End |
|---|---|---|---|
| Planned | name + optional project + duration + direction (count up 0→30 or down 30→0; default set in Settings, toggle per session) | widget shows the timer | Ring + prompt: Done / +5 / +15 / +custom / Switch task. If ignored, **overtime** counts in red and the prompt **repeats every 5 min**. The overrun is stored. |
| Timed | duration only | — | Ring + "What did you do in the last X min?" (name + project), then a new open session |
| Open | auto, or manual Start | counts up, 24h cap; **check-in every 30 min** (configurable): "What have you been doing?" → *log & continue* or *log & start fresh* | "Done" → label it → a fresh open session starts |
| Break | from the widget, optional countdown | — | ends on "Back to work", or after the countdown with a prompt. **No break reminders.** |

- Labels: a free-text name with autocomplete from history, plus an optional project from a user-managed list. Planned vs actual is stored per session.
- **Away / sleep:** idle ≥ **5 min** of no input, `suspend` or `lock-screen` cuts the running session at the last input time. On return: "You were away 1h12m — what was it?" The choices are Break / Meeting-call / Offline work (label) / Not working / **I was working** (merges the time back into the session).
- Crash safety: the active state is saved every 15 s. On restart, the gap since the last save goes through the same prompt. Away time past the end of work hours is counted as outside hours.
- **Work hours:** a schedule per weekday (with days off), overridable for today only. Outside hours there are no auto-sessions or prompts, but activity is still logged and reported separately. **Workday %** = clamp((now − start) ÷ (end − start), 0, 100).
- **Tracking:** the foreground app (exe and name) and window title are sampled every 2 s, and consecutive identical samples are merged into activity rows.
  - Chrome: domain via the UIA helper. Only the host is stored.
  - Firefox: window title only. A title-suffix map (e.g. `– YouTube` → youtube.com, user-extendable) is applied; the rest are grouped as `Firefox: <title>`.
  - Private/incognito windows are recorded as "Private browsing" with no title.
- **Categories:** Productive / Neutral / Distracting / Uncategorized. A default rule list ships with the app, and rules can match an app, a domain or a title keyword. Anything new is Uncategorized until tagged with one click (in the report or the rules editor).
- **Distraction nudge:** during a work session, **5 continuous minutes** on a Distracting app/site turns the widget red and shows a toast ("You're on youtube.com — 'Replying to emails' is running"). It's flagged in the report. No blocking.
- **Widget:** as close to Rize's desktop widget as the reference material allows. Always-on-top, frameless, draggable, and it remembers its position. It shows the current session name and timer, workday-% progress and today's productive time. Hover or click expands Start / Pause / Done / +time / Break. It can be dismissed to the tray and returns via a tray click or a global hotkey (default `Ctrl+Alt+S`). The end-of-timer ring is a built-in chime.
- **Accountability:**
  - a daily productive-time goal (shown in the widget and report)
  - a **streak** of consecutive workdays with the goal hit
  - planned vs actual per session
  - the **end-of-day review**, which auto-opens when work hours end: label any leftover time; the **"Today's wins"** and **"How I'll improve"** panels (bullet entries); and **custom KPIs** you define (e.g. "Calls made"), with numbers entered daily and charted over time.
  - Productive time = time in work sessions (excluding breaks and away time) minus time on Distracting apps/sites.
  - Day score = productive time ÷ scheduled time.
- **Reports** (dashboard window, Rize-like layout with sidebar navigation):
  - Daily: stat header (work time, productive %, goal ring, score, streak); a timeline of sessions, away blocks and a category-colored activity strip; a session list with planned vs actual; top apps/sites with **absolute time and % of tracked time** (e.g. `youtube.com 38m · 1.2%`); a category donut; distraction flags; the review panels.
  - Weekly: stacked bars per day by category, goal hits, top sites, estimate accuracy.
  - Monthly: calendar heatmap, trend lines, KPI charts.
- **Export:** for a date range, one `.xlsx` with sheets for Sessions, Activity, App-Site summary, Daily summary, Away, Reviews and KPIs, plus the same data as separate CSV files (UTF-8 with BOM, with formula-injection escaping).

## Project layout
```
src/core/      clock.ts, types.ts, schedule.ts, sessionEngine.ts, categorize.ts, titleMap.ts, merge.ts, aggregate.ts, streaks.ts  (+ *.test.ts)
src/main/      main.ts, windows.ts, tray.ts, hotkey.ts, ipc.ts, tracker.ts, idle.ts, notify.ts, export.ts, debug.ts
src/main/capture/  foreground.ts (x-win child probe), chromeUrl.ts (helper client), firefoxTitle.ts
src/main/db/   migrations/*.sql, db.ts, repo.ts
src/native/    UrlHelper.cs + build-helper.ps1 (csc.exe → resources/UrlHelper.exe)
src/renderer/  widget/, prompts/, dashboard/{daily,weekly,monthly,review,rules,settings}/, ui/ (shared components)
design/        reference/ (Rize screenshots), DESIGN.md (tokens and layout spec)
scripts/       seed.ts (fake days), db-dump.ts, soak.ts
tests/e2e/     Playwright specs; screenshots → tests/e2e/__shots__/
```
DB tables: `sessions, away_periods, activity, projects, rules, title_map, schedule, day_overrides, reviews, review_items, kpis, kpi_values, settings, heartbeat`.

---

## Phase 0: Setup and design reference
- Move the folder, save the plan, run `git init`, add `.gitignore` (node_modules, out, dist, *.db).
- **Rize UI research:** gather real images of Rize's desktop widget, timer, dashboard and reports. Sources: rize.io pages (save the `<img>` URLs), the Product Hunt gallery, Microsoft Store and Mac App Store listings, docs.rize.io articles, YouTube review thumbnails and review blogs. Download them into `design/reference/` with curl, then **view each one** with Read. If the widget isn't clearly visible, ask the user for their screenshot.
- Write `design/DESIGN.md`: color tokens (dark theme and category colors), type scale, radii and spacing, widget anatomy (collapsed and expanded, with sizes), dashboard layout, and chart styles. No Rize logo or brand marks.

**Verify:** `design/reference/` has at least 3 images showing the widget and dashboard, each reviewed. DESIGN.md covers every UI surface in this plan. Show the user a short summary of the design direction and get a go-ahead.
**Commit:** `chore: phase 0 — setup and design reference`

## Phase 1: Scaffold
- electron-vite + React + TS + Tailwind (tokens from DESIGN.md), ESLint and Prettier, Vitest, Playwright `_electron`.
- Windows: an empty widget (frameless, transparent, alwaysOnTop, skipTaskbar) and the dashboard. A tray icon with Show widget / Open dashboard / Quit. Single-instance lock.
- better-sqlite3 rebuilt for Electron. A migration runner with the full schema. The `Clock` abstraction with `SPYDER_CLOCK_SCALE`. The `SPYDER_DEBUG` IPC scaffold.
- npm scripts: `dev, build, typecheck, lint, test, test:e2e, db:dump, seed`.

**Verify:**
- `npm run typecheck && npm run lint && npm test` are all green.
- `npm run test:e2e` launches the app, asserts both windows exist and the tray was created, and saves screenshots. View them.
- `npm run db:dump` shows all tables in `%APPDATA%\Spyder\spyder.db` (use a temp `SPYDER_DATA_DIR` in tests).
- Launching a second instance focuses the first.

**Commit:** `feat: phase 1 — scaffold`

## Phase 2: Core engine (pure logic)
- `schedule.ts`: per-weekday hours, today override, `isWorkTime`, `workdayPercent`, next boundary.
- `sessionEngine.ts`: a reducer/state machine for every rule in the product spec (session types, direction, overtime and re-nag, check-ins, 24h cap, auto open session, away cut and classification including "I was working", crash recovery from heartbeat, behavior at the work-hours boundary). It emits **effects** (`ring`, `showPrompt`, `persist`, `nudge`) instead of doing I/O.

**Verify:**
- Vitest scenarios with a fake clock, each asserting the stored sessions and emitted effects:
  - planned countdown and count-up end with a ring; ignoring it gives overtime with a re-nag at +5 and +10; extend +15
  - timed session ends with the label prompt
  - open session check-ins at 30 and 60 min; log & continue vs log & start fresh
  - "Done" labelling starts a fresh timer
  - 24h cap
  - auto open session at work start and on launch mid-day
  - idle at 5 min cuts at last input; return prompt; each of the 5 classifications; "I was working" merges back
  - suspend spanning the end of work hours
  - crash with a 40-min heartbeat gap gives the prompt
  - no prompts outside hours
  - workday % at start, middle, end, before start, after end, on a day off
- Coverage of `src/core` is at least 90% (`vitest --coverage`).

**Commit:** `feat: phase 2 — session engine`

## Phase 3: Widget, tray and prompts
- Wire the engine to the main process (tick loop and persistence to `sessions` and `heartbeat`).
- Widget UI per DESIGN.md: collapsed and expanded states, drag with saved position, dismiss to tray, hotkey, red overtime state, workday-% bar.
- A start-session popover (planned / timed / open / break, name autocomplete, project picker, direction toggle). Prompt windows for the end of a timer, check-ins and away periods. The chime sound.
- Real `powerMonitor` idle polling and suspend/resume/lock/unlock feeding the engine.

**Verify (Playwright with `SPYDER_CLOCK_SCALE=600`, `SPYDER_DEBUG=1`):**
- Start a planned 30-min "Replying to emails" countdown. The prompt appears in about 3 s; ignore it, and overtime turns red and the prompt re-appears; click +15 and the timer continues.
- Timed 10 min gives the label prompt, and submitting saves it.
- An open session gets the check-in prompt.
- `debug:simulateSuspend` then a resume 72 "minutes" later gives the away prompt showing "1h 12m"; choose Break and check the DB row.
- Kill and relaunch the app gives the recovery prompt.
- Drag the widget, relaunch, and the position is kept. Dismiss and press the hotkey, and the widget is back.
- Screenshot every state and **view each one** against DESIGN.md.
- Manual check by the user, noted in the log: a real 1-min timer rings audibly.

**Commit:** `feat: phase 3 — widget and prompts`

## Phase 4: Activity tracking and categorization
- `foreground.ts`: x-win in a child probe (as in OpenTime), sampling every 2 s, with a fallback if it fails.
- `UrlHelper.cs`: .NET Framework 4.x UIA reader for Chrome's omnibox (stdin/stdout line protocol, cache, timeouts, restart cap as in OpenTime), built by `build-helper.ps1` with the built-in csc.exe.
- `firefoxTitle.ts` plus the title-suffix map. Detecting private windows.
- Merging samples into `activity` rows. Default rules seed. Categorization. The distraction nudge (5 continuous minutes on Distracting during a work session leads to the widget turning red and a toast).

**Verify:**
- Unit tests: rule matching precedence (title keyword > domain > app), title-map parsing (including YouTube, Gmail, GitHub and Reddit titles), merge logic, the nudge timer (5 min continuous, reset on switch, only during a work session).
- Integration script `scripts/capture-check.ts`:
  - opens Notepad, Chrome to `https://example.com` and Firefox to `https://www.youtube.com`, focusing each for 10 s (via PowerShell `Start-Process` and AppActivate)
  - `db:dump` shows the rows `notepad.exe`, `chrome.exe example.com` and `firefox.exe youtube.com` (from the title) with durations of about 10 s
- The helper answers in under 150 ms (p95) in Chrome.
- Using `debug:injectActivity` with youtube.com for 5 scaled minutes during a session shows the nudge in a screenshot.
- `scripts/soak.ts` runs for 10 min: CPU under 2% average while idle, memory stable.

**Commit:** `feat: phase 4 — activity tracking`

## Phase 5: Daily report and end-of-day review
- Dashboard shell with Rize-like sidebar navigation (Today / Week / Month / Review / Rules / Settings).
- Daily view per the product spec: stat header, timeline, session list with planned vs actual, top apps/sites (absolute time and %), category donut, distraction flags, Uncategorized items taggable in one click.
- Review view: label leftover time, the "Today's wins" and "How I'll improve" bullet panels, KPI inputs. It auto-opens at the end of work hours.

**Verify:**
- `npm run seed -- --days 1` creates a realistic fake day.
- Unit tests on `aggregate.ts`: app/site percentages sum to 100 (±0.1); productive time, score and goal math are correct for hand-computed fixtures.
- An e2e check opens Today and compares every displayed number against SQL in `db-dump`. It also adds a win, an improvement and a KPI value, then reloads and they persist.
- `debug:setNow` to the end of work hours opens the review.
- Screenshots viewed and checked against DESIGN.md.

**Commit:** `feat: phase 5 — daily report and review`

## Phase 6: Weekly and monthly views, goals, streaks, rules and settings
- Weekly and monthly views (stacked bars, heatmap, trends, KPI charts, estimate accuracy), streak logic, and goal settings.
- Rules editor (apps, domains, title keywords, title-suffix map), projects editor.
- Settings: schedule per weekday plus today override, idle threshold, check-in interval, nudge threshold, default direction, hotkey, autostart toggle, goal.

**Verify:**
- `seed --days 60` gives realistic weekly and monthly data.
- Streak unit tests: gaps, days off don't break the streak, today in progress.
- Changing a rule recategorizes historical reports.
- Every setting persists and takes effect without a restart (e2e for idle threshold, check-in interval and schedule).
- Screenshots viewed.

**Commit:** `feat: phase 6 — trends, goals, settings`

## Phase 7: Export
- An export dialog (date-range presets) that writes the `.xlsx` with all sheets, formatted headers, durations in both minutes and h:mm, and frozen header rows. Optional CSV folder output.

**Verify:**
- A test re-opens the xlsx with exceljs and asserts: sheet names, headers, row counts equal the DB counts for the range, the daily summary totals match `aggregate.ts`.
- The CSV parses back identically; a value like `=cmd` is escaped; Unicode titles survive.
- Open the xlsx in Excel (or LibreOffice) to confirm it renders. The user does this manually and it's noted in the log.

**Commit:** `feat: phase 7 — export`

## Phase 8: Packaging and acceptance
- electron-builder NSIS installer, app icon, `NOTICE` with OpenTime attribution, autostart at login (`app.setLoginItemSettings`), `UrlHelper.exe` bundled in resources, production build without the debug hooks.

**Verify:**
- `npm run build && npm run dist` produces the installer. Install it silently, launch it, and the widget appears.
- The autostart entry is present (check the registry `HKCU\...\Run`).
- Uninstall cleanly; user data is kept.
- The full Vitest and e2e suites are green against the packaged app.
- **User acceptance checklist** (manual, over one real workday):
  - real sleep/wake gives the away prompt
  - YouTube in Chrome and Firefox is tracked correctly
  - the end-of-day review opens
  - the export opens in Excel
  - the widget feels right

**Commit:** `chore: phase 8 — packaging`

---

## Progress log
_(the implementing agent appends: date · phase · verification results · deviations/decisions)_
