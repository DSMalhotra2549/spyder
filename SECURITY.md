# Security

## Reporting a vulnerability

Please report it privately through GitHub: on this repository, open **Security → Report a vulnerability**. Don't open a public issue for a security problem.

Include what you found, how to reproduce it and the Spyder version (Settings, or the installer's file name). Spyder is maintained by one person in their spare time, so replies and fixes come as time allows. Fixes ship as new releases.

## Supported versions

Only the latest release gets security fixes.

## Scope

Spyder is a local, single-user Windows app. It makes no network requests and has no accounts. Relevant reports include:

- a web page, window title or other captured data that can run code or reach the `window.spyder` API
- any way for something other than Spyder's own page to call its IPC handlers
- Spyder reading or writing files outside its data folder and the export paths you choose

Out of scope: attacks that already need code execution as the same Windows user (that user can read the database directly), and the unsigned installer's SmartScreen warning.

## How the app is hardened

- Every window runs sandboxed, with context isolation and no Node integration. The renderer reaches the main process only through the `window.spyder` bridge (`src/preload/`).
- IPC handlers refuse calls from any page other than Spyder's own (`src/main/paths.ts` `isAppUrl`). Windows can't open pop-ups or navigate away.
- A strict Content Security Policy allows only the app's own scripts.
- The packaged app disables `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` and validates its `app.asar` (Electron fuses in `electron-builder.yml`).
- The test hooks (`SPYDER_DEBUG=1`) stay available in the installed app on purpose, so the e2e tests can drive it (product decision P42). Setting that variable already needs control of the user's environment.

`tests/e2e/security.spec.ts` checks the sandbox, the navigation guards and the IPC origin check.
