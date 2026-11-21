// Away detection (plan Phase 3): idle polling plus suspend/lock events → AWAY_BEGIN / AWAY_END.
import { powerMonitor } from 'electron';
import type { AwayReason } from '../core/types';
import type { AppCtx } from './context';
import { addDebugHook } from './debug';
import type { EngineHost } from './engineHost';

const POLL_MS = 5000;

/** Seconds since the last input (simulated, faked or real). */
export type IdleSource = () => number;

export function startIdle(app: AppCtx, host: EngineHost): IdleSource {
  /** debug.simulateIdle: clock time of the last input, or null for the real source. */
  let simulatedLastInput: number | null = null;
  // E2E runs set this so the real machine's idleness can't interfere with scripted scenarios.
  const fakeReal = process.env.SPYDER_FAKE_IDLE === '1';
  let lastAwayEndMs = 0;

  const idleSec = () => {
    if (simulatedLastInput !== null) return Math.max(0, (app.clock.now() - simulatedLastInput) / 1000);
    return fakeReal ? 0 : powerMonitor.getSystemIdleTime();
  };

  const begin = (reason: AwayReason, atMs = app.clock.now()) => {
    host.dispatch({ type: 'AWAY_BEGIN', atMs: Math.max(atMs, lastAwayEndMs), reason });
  };
  const end = () => {
    if (host.state.mode !== 'away') return;
    lastAwayEndMs = app.clock.now();
    host.dispatch({ type: 'AWAY_END' });
  };

  const poll = () => {
    const idle = idleSec();
    const threshold = app.settings.idleThresholdSec;
    const st = host.state;
    if (idle >= threshold && st.mode === 'working') begin('idle', app.clock.now() - idle * 1000);
    else if (idle < threshold && st.mode === 'away' && st.away?.reason === 'idle') end();
  };
  setInterval(poll, POLL_MS);

  powerMonitor.on('suspend', () => begin('suspend'));
  powerMonitor.on('lock-screen', () => begin('lock'));
  powerMonitor.on('resume', end);
  powerMonitor.on('unlock-screen', end);

  addDebugHook('simulateIdle', (lastInputMs: number | null) => {
    simulatedLastInput = lastInputMs;
    poll();
  });
  addDebugHook('simulateSuspend', () => begin('suspend'));
  addDebugHook('simulateResume', end);
  addDebugHook('simulateLock', () => begin('lock'));
  addDebugHook('simulateUnlock', end);
  return idleSec;
}
