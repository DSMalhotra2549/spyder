// Foreground-window client (plan §9.1). Runs foregroundProbe in a utility process and restarts it
// with backoff (1, 2, 4, 8, 16 s; at most 5 restarts per 10 min, then capture is unavailable).
import { utilityProcess, type UtilityProcess } from 'electron';
import { basename, join } from 'node:path';
import type { ProbeReply } from './foregroundProbe';

export interface Foreground {
  exe: string;
  appName: string;
  title: string;
}

const TIMEOUT_MS = 1000;
const WINDOW_MS = 10 * 60_000;
const MAX_RESTARTS = 5;

export class ForegroundClient {
  available = true;
  private proc: UtilityProcess | null = null;
  private pending: ((r: ProbeReply | null) => void) | null = null;
  private restarts: number[] = [];
  private restartTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  start(): void {
    const p = utilityProcess.fork(join(__dirname, 'foregroundProbe.js'), [], { serviceName: 'spyder-probe' });
    p.on('message', (m: ProbeReply) => this.settle(m));
    p.on('exit', (code) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.settle(null);
      if (!this.stopped) this.scheduleRestart(code);
    });
    this.proc = p;
  }

  private scheduleRestart(code: number): void {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.available = false;
      console.error(`[spyder] foreground probe keeps crashing (exit ${code}); capture disabled`);
      return;
    }
    const delay = 1000 * 2 ** this.restarts.length;
    this.restarts.push(now);
    console.warn(`[spyder] foreground probe exited (${code}); restarting in ${delay / 1000}s`);
    this.restartTimer = setTimeout(() => this.start(), delay);
  }

  private settle(r: ProbeReply | null): void {
    const fn = this.pending;
    this.pending = null;
    fn?.(r);
  }

  /** The foreground window, or null if unavailable / probe busy or restarting. */
  sample(): Promise<Foreground | null> {
    const p = this.proc;
    if (!p || this.pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(null), TIMEOUT_MS);
      this.pending = (r) => {
        clearTimeout(timer);
        if (!r?.ok || !r.path) return resolve(null);
        resolve({ exe: basename(r.path).toLowerCase(), appName: r.name || basename(r.path), title: r.title ?? '' });
      };
      p.postMessage('sample');
    });
  }

  /** Debug: simulate a crash. */
  kill(): void {
    this.proc?.kill();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.proc?.kill();
    this.proc = null;
  }
}
