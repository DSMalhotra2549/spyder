# Changelog

What changed on `main`, newest first, written for whoever pulls next (people and their agents). Each entry says
**what** changed for the user, **why**, and **if you pull this**: anything that behaves differently for you, such as a
changed default, a migration, a new setting or a test-helper change. The full reasoning is in the P decision it cites
(`docs/product-decisions.md`).

Add an entry in the same commit as the change (see AGENTS.md → Commits).

## 2026-11-25: Spider web icon (P91)

**What**
- Spyder's app, installer and tray icon is now a spider web instead of the purple circle with an "S".

**Why**
The user wanted a spider web as Spyder's icon.

**If you pull this**
- `resources/icon.png` is now the source image; `scripts/make-icon.ps1` and `npm run icon` are gone (running it would have overwritten the web).

## 2026-11-25: Glass tint slider in Settings (P90)

**What**
- Settings → Look has a **Glass tint** slider: 0 % is clear glass, 100 % is a solid sidebar colour, in steps of 5. It retints the dashboard's glass frame live as you drag and is kept; `Reset` brings back 55 %.

**Why**
The user wanted to choose how dark or see-through the glass is.

**If you pull this**
- New setting `glassTint` (whole percent 0–100, default 55); the dashboard reads it into the CSS variable `--glass-tint`. E2e: the slider is `set-glassTint`, its reset `reset-glassTint`; new screenshot `settings-glass-tint.png`.

## 2026-11-25: Smoke-tinted glass sidebar (P89)

**What**
- The dashboard's glass frame (the sidebar and the edge around the content card) has a see-through smoke tint: charcoal in dark, frost in light. The glass still shows through, but the colour no longer follows the wallpaper.

**Why**
The user disliked the untinted sidebar's colour and wanted a calm, even one while keeping the Arc glass look.

**If you pull this**
- `--color-sidebar` is in use again, as the tint colour (at 55 %). `theme.spec.ts` checks the tint in both themes.

## 2026-11-25: Visualizer page, today as a 24-hour star clock (P88)

**What**
- A **Visualizer** item in the sidebar's Day group, after Review, shows today as a 24-hour star clock (00 at the top, 12 at the bottom) on an always-dark night sky.
- A slowly spinning ring of stars carries the bar: a comet at now, stars lit purple across the work hours passed. The bar's numbers sit in the middle.
- Outward rings: the block track, then the app track (Today's timeline colours), with distraction flags, a now hand and hour labels; an inner ring fills toward the daily goal. Hover shows the timeline's details. View only, today only; stars hold still under reduced motion.

**Why**
The user wanted a clock view of the day as its own page, so nothing else in the app changes.

**If you pull this**
- New e2e spec `tests/e2e/visualizer.spec.ts` and screenshot `__shots__/visualizer.png`. Nav id `visualizer`, route `#/dashboard/visualizer`.

## 2026-11-25: Arc look, glass dashboard and prompt, soft shapes (P87)

**What**
- The dashboard window is Windows 11 acrylic glass with no title bar; Windows' min/max/close sit over the glass and the top strip drags the window.
- The sidebar is see-through glass; the current page is a frosted pill that slides between items; the timer card is frosted.
- Each page sits on a floating rounded card. Bigger page title, stats as separate rounded tiles, block rows as soft rounded tiles (joined blocks form one tile). A row's checkbox and dropdown arrows show on hover or when ticked.
- Short motion (page fade-in, tile lift, sliding pill), off when Windows animations are off.
- The prompt window is acrylic glass too. The bar is unchanged.

**Why**
The user wanted Spyder much prettier, Arc-style, with real see-through glass. Appearance only; amends P56's flat style.

**If you pull this**
- Glass shows only on the focused window; unfocused, in battery saver or with Transparency effects off, Windows paints a flat colour.
- `theme.spec.ts` now checks the resolved `--color-bg` token instead of `body`'s background, which is see-through. Screenshots in `__shots__` can't capture acrylic, so the sidebar looks washed out there.
- `windowBackground()` is gone from `src/main/theme.ts`; use `titleBarOverlay()` for the dashboard's window buttons.
- Known failure: `widget.spec.ts` test 8 fails most runs at `widgetOnTop` before the first minimize. The dashboard window's acrylic causes it (without it, the test passes). Merged as is on the user's call; the bar may sometimes drop behind other apps while the glass dashboard is open.

## 2026-11-25: Unmerge a merged block any time (P86)

**What**
- A merged block on Today shows a small **Unmerge** icon (↶) next to the pencil and trash on hover. It splits the block back into the blocks it was made from, each with its own answer, tag and rating as before the merge. It works any time, after restarts too; the Undo toast still undoes the unmerge.

**Why**
A merge could only be undone from the Undo toast, which is gone after a few seconds, the next edit or a restart.

**If you pull this**
- Migration 006 adds a `merges` table recording what each merge combined. Merges made before it can't be unmerged.
- New IPC call `unmergeBlock(id)`; `SessionLine` gains `merged`. E2e: the icon is `block-unmerge`.

## 2026-11-25: README brought up to date (P75–P85)

**What**
- The README describes Track from startup (on by default), Every day work hours, the bar's goal/workday percent, two-step minimize, efficiency ratings, the Today stats and app track, and the theme, font and app colour settings. The old "Nothing starts by itself" line is gone.

**Why**
The README still described the app as of P74.

**If you pull this**
- Nothing special.

## 2026-11-25: App track switch under Today's timeline (P85)

**What**
- A small **App track** switch under Today's timeline. Off, the timeline is back to how it looked before the app track (P77): the blocks with the thin category strip under them, and no app legend. It's on by default and remembers your choice.

**Why**
The app track shows every app switch, which makes the timeline busy. The user wants to be able to hide it.

**If you pull this**
- New settings key `showAppTrack` (boolean, default `true`). No migration. E2e: the switch is `app-track-toggle`.

## 2026-11-25: Every day is a toggle in Work hours (P84)

`3f4d947`

**What**
- In **Settings → Work hours**, **Every day** has a switch. When it's on, you set one start–end for all 7 days, and the weekday rows and **Today only** are hidden. When it's off, the weekday rows and Today only show as before.
- The `days differ` hint is gone. The switch now shows whether all 7 days share the same hours.

**Why**
The user wants a short card when every day has the same hours, and the full grid only when they differ.

**If you pull this**
- Nothing special: no setting or migration. The switch starts on when all 7 days already match. E2e: the Every day switch is `sched-all-enabled`, and the `sched-all-start`/`-end` fields only exist while it's on.

## 2026-11-25: Minimize in two steps (P83)

`43b7e48`

**What**
- The bar's **minimize** button no longer hides the bar straight away. While the bar is on top, it drops the bar behind all your windows. Pressed again while the bar is behind, it sends the bar to the tray.
- A tray click, **Show widget** or the hotkey puts the bar back on top. If the bar is behind your windows, the hotkey brings it back on top instead of hiding it.

**Why**
The user wanted the bar out of the way of their apps but still on the desktop, with the tray one more press away.

**If you pull this**
- Run `npm run build:helper`: `UrlHelper.exe` has a new `back <hwnd>` mode that puts the bar behind other windows. Without the rebuilt helper the bar only stops being on top.
- New IPC `minimizeWidget` (`hideWidget` still hides straight away). The debug `state()` has a new `widgetOnTop` field.

## 2026-11-25: Local reinstall on push, not on every commit

**What**
- The maintainer's auto-reinstall now runs after a successful `git push` of `main` (`.githooks/pre-push`), not after every commit. The `.githooks/post-commit` hook is gone.

**Why**
A rebuild after every commit was slow and ran several reinstalls back to back. Pushing is the point where a change is meant to be used.

**If you pull this**
- Only matters if you turned the hooks on (`core.hooksPath .githooks`, maintainer only). Committing no longer reinstalls. Pushing `main` does, about 3 minutes later. To reinstall without pushing, run `npm run install:local`.

## 2026-11-25: Bar percent setting, Every day work hours, Track from startup on by default (P82)

`6eaa43d`

**What**
- **Track from startup is on by default.** On a fresh install the loop starts by itself at launch, without pressing Start.
- New setting **Settings → Look → Bar percent**: `Of day` shows how much of today's work hours has passed (the workday %). `Of goal` shows today's productive time ÷ the daily goal (the goal %). Default: `Of goal`. The bar no longer chooses the percent from Track from startup.
- **Work hours** has a new **Every day** row at the top: one start–end that turns all 7 days on with those hours. It's empty and shows `days differ` until all 7 days match. 12 AM as the end means midnight.

**Why**
Under Track from startup the user still wants to see how much of their usual work hours (11 AM–12 AM every day) has passed and how much is left, without entering the same hours 7 times.

**If you pull this**
- An existing install that already **saved Track from startup off** keeps it off and gets `Bar percent = Of day`, so its bar looks the same. Every other install gets the new defaults (seeded at boot, `src/main/db/seedDefaults.ts`).
- Using Every day turns **weekends on**, so streak and day score count every day.
- New settings key `barPercent` (`'day' | 'goal'`). `EngineSettings` includes it.
- **Tests:** `launch()` in `tests/e2e/helpers.ts` now sets `SPYDER_DEFAULTS` to `{"trackFromStartup":false,"barPercent":"day"}`, so existing e2e tests keep the old first-run behaviour. To test the real defaults, pass `env: { SPYDER_DEFAULTS: '{}' }`. Unit tests use `trackFromStartup: false` through `engine.testkit.ts`.
- New debug env var `SPYDER_DEFAULTS` (JSON, only with `SPYDER_DEBUG=1`) sets first-run settings.

## 2026-11-24: Coherence pass, productive green, one colour per app (P80, P81)

`1ed1404` (PR #7)

**What**
- Productive time is the headline number: it leads every stat row. Today shows Productive · Work · Efficiency · Streak. Day score moved to Review, Week and Month.
- One word per idea: Work, Day score, Not accounted for, Apps & sites. The sidebar group is named "Day".
- Settings is regrouped into Work hours · Blocks & nudges · Goal · Look · Tracking · System. Block length is set only in the sidebar.
- KPIs are set up on Review (add, or Edit to rename or remove). The Rules page has no KPIs tab.
- Productive uses the goal-met green everywhere. Each app keeps one colour across the dashboard, its app-track colour.
- Removed the empty Estimate accuracy table and its planned-session code.

**Why**
Features added one by one had drifted apart in wording, colours and placement.

**If you pull this**
- Settings and KPI controls moved, so update any e2e test or doc that points to the old place.

## 2026-11-24: App track on the timeline, font choice, app colours (P77–P79)

`04fb2ce`

**What**
- P77: a second track under the blocks on the timeline shows which app or site was in front. It replaces the thin category strip.
- P78: **Settings → Font** switches every window between Segoe UI and Atkinson Hyperlegible Next.
- P79: each app gets a fixed automatic colour from its name. Any app's colour can be picked from the timeline legend or **Settings → App colours**.

**Why**
To see which apps a block was spent in, and to make the app more readable.

**If you pull this**
- New settings keys: `font` (`'system' | 'atkinson'`) and `appColors` (an app → `#rrggbb` map).

## 2026-11-24: Track from startup, sleep ends the loop (P76)

`63ae18f`

**What**
- New Settings switch, **Track from startup** (off at the time; P82 turned it on by default). While it's on, the loop starts by itself on launch and on wake and ignores work hours.
- Sleep cuts the block like a shutdown does. So does a minute without a heartbeat.
- The block running at midnight is cut at midnight.

**Why**
For a user who works whenever the computer is on rather than in fixed hours.

**If you pull this**
- New settings key `trackFromStartup`.

## 2026-11-24: Efficiency rating for work blocks (P75)

`7865a92` (PR #4), follow-ups `b9b6aa7`

**What**
- An optional 25/50/75/100% rating in the end-of-block prompt and on Today. Day and range efficiency and effective time show on Today, Review, Week and Month, and are included in exports.
- Unrated blocks count in neither total.
- Tagging a block Break, Gym or Food clears its rating.

**Why**
Time worked doesn't say how well it went. The user wanted a quick self-rating.

**If you pull this**
- **Migration 005** adds `sessions.efficiency`. It runs on first launch.
