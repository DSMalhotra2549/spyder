# SQLite storage via the built-in `node:sqlite` module

**Status:** accepted (2026-11-21)

All data is stored in one SQLite file (`%APPDATA%\Spyder\spyder.db`), accessed through Node's built-in `node:sqlite` (`DatabaseSync`). Electron 45 bundles Node 24.22, which ships `node:sqlite`, and the system Node 25 used by Vitest and the scripts has the same API. That means **no native module needs compiling or rebuilding for Electron**. Native rebuilds (node-gyp, Visual Studio build tools, ABI mismatches) are the most common way agent-driven Electron builds fail on Windows.

## Considered options
- **better-sqlite3 + @electron/rebuild.** This is the fallback if `node:sqlite` turns out to be unavailable or broken in the Electron version in use. Phase 1 checks this explicitly.
- **JSON files per day** (OpenTime's approach). Rejected: reports need range queries (weekly, monthly, exports) and joins between sessions, segments, activity and away periods.
