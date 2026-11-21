// Injected clock (plan §11, ADR-0006). Pure: the real-time source is passed in.
export interface Clock {
  now(): number;
  setNow(ms: number): void;
  advance(sec: number): void;
  readonly scale: number;
}

export interface ClockOptions {
  /** Clock time at creation (epoch ms). Defaults to realNow() at creation. */
  origin?: number;
  /** Clock ms per real ms. Default 1. */
  scale?: number;
  /** Real-time source, e.g. Date.now. */
  realNow: () => number;
}

export function createClock(opts: ClockOptions): Clock {
  const realOrigin = opts.realNow();
  const origin = opts.origin ?? realOrigin;
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  let offset = 0;
  const base = () => origin + (opts.realNow() - realOrigin) * scale;
  return {
    scale,
    now: () => Math.round(base() + offset),
    setNow(ms) {
      offset = ms - base();
    },
    advance(sec) {
      offset += sec * 1000;
    },
  };
}

/** Parse SPYDER_NOW (ISO local time like '2026-11-24T11:00:00') into epoch ms; undefined if absent/invalid. */
export function parseLocalIso(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) return undefined;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
}
