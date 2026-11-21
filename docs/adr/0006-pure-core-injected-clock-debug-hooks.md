# Pure core engine with an injected clock and debug hooks

**Status:** accepted (2026-11-21)

All behavioral logic lives in `src/core/` as pure TypeScript: session engine, schedule, nudge, categorization, aggregation. It has no Electron and no I/O. The session engine is a reducer, `(state, event, ctx) → { state, effects }`. Time always comes from an injected `Clock`. The main process carries out the effects (database writes, sound, prompts, notifications).

For testing, the app supports:
- `SPYDER_CLOCK_SCALE` (e.g. `600`, so 30 minutes passes in 3 s)
- `SPYDER_NOW` (a fixed start instant)
- `SPYDER_DATA_DIR` (a throwaway database)
- debug IPC hooks (`SPYDER_DEBUG=1` only) that simulate idle, suspend/resume, time jumps and activity

This is what lets the implementing agent **verify its own work**. Without it, timer, check-in and sleep behavior could only be tested by waiting for real minutes or hours.
