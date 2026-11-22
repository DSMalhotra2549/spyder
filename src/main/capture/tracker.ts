// Activity sampler (plan §9.1): every sampleIntervalSec of real time, read the foreground window,
// resolve the browser domain, merge into activity rows, feed the nudge, and write in batches.
import { isIgnoredExe } from '../../core/defaults';
import { flushMerge, initialMerge, mergeSample, type ActivityRow, type ActivitySampleRow, type MergeState } from '../../core/merge';
import { resolveDomain, type OmniboxMemo } from '../../core/url';
import type { AppCtx } from '../context';
import { insertActivity } from '../db/repo';
import type { EngineHost } from '../engineHost';
import type { IdleSource } from '../idle';
import { ChromeUrlClient } from './chromeUrl';
import { FirefoxTitles } from './firefoxTitle';
import { ForegroundClient } from './foreground';

const BATCH_MS = 30_000;
const BROWSERS: Record<string, ActivitySampleRow['browser']> = {
  'chrome.exe': 'chrome',
  'msedge.exe': 'edge',
  'firefox.exe': 'firefox',
};

export class Tracker {
  readonly fg = new ForegroundClient();
  readonly chrome = new ChromeUrlClient();
  readonly firefox: FirefoxTitles;
  samples = 0;
  private merge: MergeState = initialMerge();
  private batch: ActivityRow[] = [];
  private memo: OmniboxMemo | null = null;
  private timer: NodeJS.Timeout | undefined;
  private batchTimer: NodeJS.Timeout | undefined;
  private busy = false;
  private readonly app: AppCtx;
  private readonly host: EngineHost;
  private readonly idleSec: IdleSource;

  constructor(app: AppCtx, host: EngineHost, idleSec: IdleSource) {
    this.app = app;
    this.host = host;
    this.idleSec = idleSec;
    this.firefox = new FirefoxTitles(app.db);
  }

  private get intervalMs(): number {
    return this.app.settings.sampleIntervalSec * 1000;
  }

  start(): void {
    this.fg.start();
    this.chrome.start();
    const loop = () => {
      void this.tick().finally(() => {
        this.timer = setTimeout(loop, this.intervalMs);
      });
    };
    this.timer = setTimeout(loop, this.intervalMs);
    this.batchTimer = setInterval(() => this.write(), BATCH_MS);
  }

  /** One sample. Public so debug hooks can drive it. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.app.clock.now();
      const idle = this.idleSec();
      if (this.host.state.away !== null || idle >= this.app.settings.idleThresholdSec) {
        this.close(now - idle * 1000);
        return;
      }
      const s = await this.read();
      if (!s) return;
      // Spyder and shell overlays (P44): end the previous app's row here, record nothing.
      if (isIgnoredExe(s.exe)) {
        this.close(now);
        return;
      }
      const ts = this.app.clock.now();
      const r = mergeSample(this.merge, s, ts, this.intervalMs);
      this.merge = r.state;
      if (r.closed) this.batch.push(r.closed);
      this.samples++;
      this.host.feedSample({ exe: s.exe, appName: s.appName, domain: s.domain, title: s.title, browser: s.browser }, ts);
    } finally {
      this.busy = false;
    }
  }

  private async read(): Promise<ActivitySampleRow | null> {
    const fg = await this.fg.sample();
    if (!fg) return null;
    if (isIgnoredExe(fg.exe)) return { exe: fg.exe, appName: fg.appName, title: null, domain: null, browser: null, isPrivate: false };
    const browser = BROWSERS[fg.exe] ?? null;
    const base = { exe: fg.exe, appName: fg.appName, title: fg.title || null, domain: null, browser, isPrivate: false };
    if (browser === 'firefox') return { ...base, ...this.firefox.parse(fg.title) };
    if (browser === 'chrome' || browser === 'edge') {
      const o = await this.chrome.foreground();
      if (!o) return base;
      const r = resolveDomain(o.value, o.hwnd, base.title, this.memo);
      this.memo = r.memo;
      return { ...base, domain: r.domain };
    }
    return base;
  }

  /** Close the open row (never past capMs) into the batch. */
  private close(capMs: number): void {
    const r = flushMerge(this.merge, capMs, this.intervalMs);
    this.merge = r.state;
    if (r.closed) this.batch.push(r.closed);
  }

  private write(): void {
    const rows = this.batch;
    this.batch = [];
    insertActivity(this.app.db, rows);
  }

  /** Close the open row at the last input time and write everything (idle, away, quit, debug). */
  flush(): void {
    const now = this.app.clock.now();
    this.close(now - this.idleSec() * 1000);
    this.write();
  }

  stop(): void {
    clearTimeout(this.timer);
    clearInterval(this.batchTimer);
    this.flush();
    this.fg.stop();
    this.chrome.stop();
  }

  debugState(): Record<string, unknown> {
    return {
      foregroundAvailable: this.fg.available,
      chromeAvailable: this.chrome.available,
      samples: this.samples,
      open: this.merge.open,
      batched: this.batch.length,
    };
  }
}
