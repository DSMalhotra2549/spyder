# Changelog

What changed on `main`, newest first, written for whoever pulls next (people and their agents). Each entry says
**what** changed for the user, **why**, and **if you pull this**: anything that behaves differently for you, such as a
changed default, a migration, a new setting or a test-helper change. The full reasoning is in the P decision it cites
(`docs/product-decisions.md`).

Add an entry in the same commit as the change (see AGENTS.md → Commits).

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
