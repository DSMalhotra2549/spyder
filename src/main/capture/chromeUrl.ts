// Chrome/Edge URL client (plan §9.2, ADR-0008): one UrlHelper.exe process, one request in flight,
// 800 ms timeout. Restarts on exit (at most 5 per 10 min), then gives up and domains stay null.
import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface OmniboxRead {
  hwnd: number;
  value: string;
}

const TIMEOUT_MS = 800;
const WINDOW_MS = 10 * 60_000;
const MAX_RESTARTS = 5;

export function helperPath(): string {
  // Dev/test: the bundle lives in out/main, so the repo's resources/ is two levels up.
  return app.isPackaged ? join(process.resourcesPath, 'UrlHelper.exe') : join(__dirname, '../../resources/UrlHelper.exe');
}

type Reply = { ok: true; hwnd?: number; value?: string } | { ok: false; error: string };

export class ChromeUrlClient {
  available = true;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending: ((r: Reply | null) => void) | null = null;
  /** Replies still owed for requests that timed out; dropped when they arrive. */
  private stale = 0;
  private restarts: number[] = [];
  private stopped = false;

  start(): void {
    const exe = helperPath();
    if (!existsSync(exe)) {
      this.available = false;
      console.warn(`[spyder] ${exe} missing (run npm run build:helper); Chrome domains disabled`);
      return;
    }
    const p = spawn(exe, [], { windowsHide: true });
    this.proc = p;
    this.stale = 0;
    createInterface({ input: p.stdout }).on('line', (line) => {
      if (this.stale > 0) {
        this.stale--;
        return;
      }
      let r: Reply | null;
      try {
        r = JSON.parse(line) as Reply;
      } catch {
        r = null;
      }
      this.settle(r);
    });
    p.on('error', (e) => console.warn('[spyder] UrlHelper error', e.message));
    p.on('exit', (code) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.settle(null);
      if (this.stopped) return;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < WINDOW_MS);
      if (this.restarts.length >= MAX_RESTARTS) {
        this.available = false;
        console.error(`[spyder] UrlHelper keeps exiting (${code}); Chrome domains disabled`);
        return;
      }
      this.restarts.push(now);
      this.start();
    });
  }

  private settle(r: Reply | null): void {
    const fn = this.pending;
    this.pending = null;
    fn?.(r);
  }

  private request(cmd: string): Promise<Reply | null> {
    const p = this.proc;
    if (!p || this.pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.stale++;
        this.settle(null);
      }, TIMEOUT_MS);
      this.pending = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      p.stdin.write(`${cmd}\n`);
    });
  }

  /** The foreground window's omnibox, or null (not a browser window, timeout, helper down). */
  async foreground(): Promise<OmniboxRead | null> {
    const r = await this.request('fg');
    if (!r?.ok || r.hwnd === undefined) return null;
    return { hwnd: r.hwnd, value: r.value ?? '' };
  }

  async ping(): Promise<boolean> {
    return (await this.request('ping'))?.ok === true;
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }
}
