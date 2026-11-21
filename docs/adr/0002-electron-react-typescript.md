# Electron + React + TypeScript (not Tauri)

**Status:** accepted (2026-11-21)

Spyder is an Electron app with a React + TypeScript renderer, built with electron-vite. Electron provides, out of the box, everything Spyder depends on:
- `powerMonitor` (idle time, suspend/resume, lock/unlock)
- `Tray`, `globalShortcut` and `Notification`
- frameless, transparent, always-on-top windows

OpenTime's capture code (ADR-0001) is also TypeScript/Electron, so it can be reused directly. Electron is also the stack AI coding agents handle most reliably.

## Considered options
- **Tauri 2** (Rust + webview). Rejected despite much lower memory use (~30 MB vs ~150 MB). Idle, sleep, lock and UI Automation would all have to be written in Rust, and OpenTime's code couldn't be reused. The memory saving doesn't matter on a personal desktop.

## Consequences
- ~150 MB RAM, and an installer of about 100 MB.
- All windows (widget, prompt, dashboard) share one renderer bundle and are routed by URL hash (`#/widget`, `#/prompt`, `#/dashboard/...`), which keeps the build config simple.
