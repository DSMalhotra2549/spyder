# Spyder

A personal Windows app that holds you accountable for your working time.

Most time trackers quietly log what you did. Spyder is stricter: **during work hours, every minute belongs to a labelled session**. If nothing is running, an open session starts on its own, and sooner or later Spyder asks what it was. Time you spend away from the computer is noticed too, and you're asked what it was.

No accounts, no cloud and no AI. Everything stays in a local SQLite file on your machine.

## What it does

- **Floating widget.** A small always-on-top bar shows the session timer, today's productive time and how much of the workday has passed. It turns red when you're distracted or over time.
- **Four kinds of session.**
  - **Planned:** a name and a duration, counting up or down.
  - **Timed:** just a duration; you name it when the time is up.
  - **Open:** counts up until you say what you did.
  - **Break.**
- **Prompts that don't let time slip.**
  - The time's-up prompt rings and keeps nagging. If you ignore it, the session runs into overtime.
  - Open sessions check in every 30 minutes.
  - When you come back from being idle, asleep or locked, you classify the gap: break, meeting, offline work, not working, or "I was working".
- **App and website tracking.** It records the foreground app every 2 seconds, Chrome sites from the address bar and Firefox sites from the window title. No browser extensions needed.
- **Categories and nudges.** Apps and sites are Productive, Neutral, Distracting or Uncategorized, based on editable rules. After 5 straight minutes on something distracting during a work session, you get a gentle nudge. Nothing is ever blocked.
- **Reports.**
  - **Today:** your productive time against your goal, a timeline and your top apps.
  - **Week:** stacked bars per day.
  - **Month:** a heatmap and trend lines.
- **End-of-day review.** When work hours end, you label any leftover time, write *Today's wins* and *How I'll improve*, and record your own daily numbers (KPIs). Meeting your goal on consecutive workdays builds a streak.
- **Export.** Any date range goes out to one `.xlsx` workbook plus matching CSVs.

## Getting started

You need **Windows 10/11** and **Node.js 22.13 or newer** (`node:sqlite` is used; development was done on Node 25).

```powershell
git clone https://github.com/perplexingpasta/spyder.git
cd spyder
npm install
npm run build:helper   # builds the small Chrome address-bar reader (uses Windows' own C# compiler)
npm run dev            # starts the app with hot reload
```

> `npm run dev` uses your real data folder (`%APPDATA%\Spyder`). To experiment without touching it, set a throwaway folder first:
> `$env:SPYDER_DATA_DIR = "$env:TEMP\spyder-test"; npm run seed; npm run dev`

**Build an installer:** `npm run dist` writes `release/Spyder Setup <version>.exe`. This is a per-user install that starts with Windows. Uninstalling keeps your data.

**Shortcuts:** `Ctrl+Alt+S` shows or hides the widget. The tray icon has everything else.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development mode |
| `npm run typecheck` / `npm run lint` | Type-check and lint |
| `npm test` | Unit tests (Vitest) for the core logic |
| `npm run test:e2e` | Build, then run the end-to-end tests (Playwright driving Electron) |
| `npm run seed` | Fill `SPYDER_DATA_DIR` with realistic sample days |
| `npm run db:dump` | Print what's in the database |
| `npm run dist` | Build the Windows installer |
| `npm run install:local` | Build the installer, install it over the local app and restart it (runs after every commit on `main`) |

## How it's built

```
src/core/      Pure TypeScript: session engine (a reducer), schedule, nudges, categories, reports
src/main/      Electron main process: runs the engine, idle detection, app/site capture, SQLite, export
src/preload/   The window.spyder API the UI talks through
src/renderer/  React UI: widget, prompt window and dashboard (one bundle, hash routes)
src/native/    UrlHelper.cs, which reads Chrome's address bar via UI Automation
tests/e2e/     Playwright tests against the built app
```

The core logic never reads the real clock. Time is passed in, so tests can run a whole workday in seconds (`SPYDER_CLOCK_SCALE`, `SPYDER_NOW`).

## Documentation

| File | Read it for |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | The vocabulary: session, segment, away period, check-in, nudge, review… |
| [`docs/product-decisions.md`](docs/product-decisions.md) | Every behavior decision and why it was made |
| [`docs/adr/`](docs/adr/) | Architecture decisions (why Electron, why `node:sqlite`, why no AI, …) |
| [`SPYDER_PLAN.md`](SPYDER_PLAN.md) | The full original spec and the build log |
| [`design/DESIGN.md`](design/DESIGN.md) | Visual design: colors, type, widget and page layouts |
| [`AGENTS.md`](AGENTS.md) | Orientation for AI coding agents working on the repo |

## Credits

The Windows capture techniques are adapted from [OpenTime](https://github.com/ElectricGamer61/OpenTime) (Apache-2.0). See [`NOTICE`](NOTICE). The look of the widget was inspired by Rize; none of its branding is used.

## License

[MIT](LICENSE)
