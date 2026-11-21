# Build from scratch, reusing OpenTime's Windows capture code

**Status:** accepted (2026-11-21)

Before building, we surveyed existing Rize-like trackers in November 2026. None has Spyder's core: an always-on session timer with an on-screen widget, end-of-timer and check-in prompts, and classification of away time. So we build Spyder from scratch, but copy the hard Windows-specific capture techniques from **OpenTime** (github.com/ElectricGamer61/OpenTime, Apache-2.0, credited in `NOTICE`):
- foreground-window detection with `@miniben90/x-win` run in a child process
- the UI Automation approach for reading Chrome's address bar
- `powerMonitor` idle handling

## Considered options
- **Fork OpenTime** (Apache-2.0, Electron/React/TS, Windows). Rejected:
  - It's a passive tracker built around one main window, with no floating widget, no end-of-timer prompt, no check-ins and no away classification.
  - It has a single maintainer, about 7 weeks of history, 0 stars, and a 42 KB `main.ts`.
  - We'd rewrite most of it while inheriting its structure.
- **ActivityWatch as the tracking backend** (19.8k★, MPL-2.0). Rejected: a separate Python/Rust server plus a browser extension is too many moving parts for a personal Windows app, and it has no session concept.
- **Dayflow** (MIT, 7.5k★). Rejected: macOS only, and built around screen recording plus AI.
- **Dayflow Windows port.** Rejected: the CC BY-NC-SA license, it sends screenshots to a cloud model by default, and its README contradicts itself.
- **rize-local-public.** Rejected: no license, so its code can't legally be reused.
