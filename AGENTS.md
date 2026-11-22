# AGENTS.md

Spyder is a personal Windows app (Electron + React + TypeScript) that makes every minute of work hours belong to a labelled session. All 8 build phases are done; the user's one-workday acceptance of Phase 8 is still pending. Work since then is tracked as product decisions (P43 onward), not as phases.

## Sources of truth

Each one owns its own subject. Update the owner, and point to it from elsewhere.

- **`CONTEXT.md`**: the glossary. Use its terms exactly in code, UI copy and commits. Read it first.
- **`docs/product-decisions.md`**: every settled behavior decision (P1…), with the reasons. Read it before changing behavior. Ask the user about anything it doesn't cover, then record the answer as the next P number.
- **`docs/adr/`**: architectural decisions. Read the relevant ADR before touching storage, capture, the stack or the engine's shape. Record new hard-to-reverse choices as the next ADR.
- **`SPYDER_PLAN.md`**: the original spec. Use it for the engine rules (§7, E1–E19), nudge (§8), capture (§9), aggregation (§10), IPC (§11) and UI behavior (§12), and its progress log (§14) for what was verified and how. A later P decision overrides the plan.
- **`design/DESIGN.md`**: visual spec (tokens, widget anatomy, pages). Follow it for any UI change.

## Code map

- `src/core/`: **pure** logic. The session engine is a reducer `reduce(state, event, ctx) → { state, effects }`. It also holds schedule, nudge, categorize, title patterns, aggregation, streaks, trends, CSV, and the view models (`widgetView`, `promptView`). Unit-tested with Vitest next to each file.
- `src/main/`: the Electron main process. `engineHost.ts` owns engine state, runs the tick and carries out effects. `idle.ts` turns powerMonitor into away events. `capture/` + `tracker.ts` sample the foreground app every 2 s. `db/` is `node:sqlite`, `report.ts` builds the dashboard data, `export.ts` writes xlsx/CSV, and `debug.ts` holds the test hooks.
- `src/preload/`: `window.spyder`, the only bridge from renderer to main (`api.d.ts` is the contract).
- `src/renderer/`: one bundle, routed by URL hash: `#/widget`, `#/prompt`, `#/dashboard/<page>/<date?>`.
- `src/native/UrlHelper.cs`: reads Chrome's address bar over UI Automation (ADR-0008).
- `tests/e2e/`: Playwright against the built Electron app. `helpers.ts` `launch()` gives you a fresh data dir, a fake clock and the debug API.

## Invariants

- `src/core/` imports nothing from Electron, `node:fs` or `node:sqlite`, and gets time only from `ctx.now` (ADR-0006, enforced by ESLint).
- Activity rows store raw facts; categories and Firefox sites are computed at read time (ADR-0005, P39).
- A session's time is the sum of its segments (ADR-0004).
- Prompt wording comes from `src/core/promptView.ts`, which follows plan §12 exactly.
- No AI or LLM features of any kind (ADR-0009).
- TypeScript strict. Any `any` carries a `// reason:` comment.

## Verify

Every change ends **green** on:

```
npm run typecheck
npm run lint
npm test            # Vitest, src/core
npm run test:e2e    # builds, then Playwright (~minutes, one worker)
```

For UI changes, open the PNGs the e2e tests save in `tests/e2e/__shots__/` with the Read tool and compare them with `design/DESIGN.md`. Fix what looks wrong before calling it done. Add or extend a test for every behavior change, and keep existing tests as they are. If one seems wrong, ask the user.

Time-dependent behavior is tested by controlling the clock, not by waiting:
- `SPYDER_NOW` (fixed start, ISO local time)
- `SPYDER_CLOCK_SCALE` (e.g. `600`)
- `SPYDER_DATA_DIR` (throwaway DB)
- `SPYDER_DEBUG=1` (exposes `window.spyder.debug`: `advance`, `setNow`, `simulateIdle`, `simulateSuspend`, `injectActivity`, …)

The e2e helper also sets `SPYDER_CAPTURE=0` and `SPYDER_FAKE_IDLE=1`, so the real desktop can't disturb tests.

## Gotchas

- `npm run dev` with no `SPYDER_DATA_DIR` uses the **real** database in `%APPDATA%\Spyder`. So do `npm run seed` and `npm run db:dump`, which means seeding without it writes fake days into the user's real data. Set `SPYDER_DATA_DIR` to a temp dir before experimenting or seeding.
- One instance per data dir. A second launch against the same dir exits silently.
- `resources/UrlHelper.exe` is gitignored. Run `npm run build:helper` before testing Chrome site capture or `npm run dist`.
- Run `scripts/capture-check.ts` from PowerShell. The Store version of Notepad won't launch from Git Bash.
- The default widget style is `bar` (P43, P49). Full and Compact still exist and must keep working.
- After 3 failed attempts at the same problem, stop and ask the user, with the exact error and what you tried.

## Commits

Conventional style, citing the decision it implements, e.g. `feat: bar label wraps to two lines (P47)`. Commit only when the user asks.
