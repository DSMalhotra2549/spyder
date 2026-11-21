import { describe, expect, it } from 'vitest';
import { createClock, parseLocalIso } from './clock';

describe('clock', () => {
  it('scales real time from the origin and supports setNow/advance', () => {
    let real = 1_000;
    const c = createClock({ origin: 50_000, scale: 600, realNow: () => real });
    expect(c.now()).toBe(50_000);
    real += 1_000; // one real second = 10 clock minutes
    expect(c.now()).toBe(50_000 + 600_000);
    c.advance(60);
    expect(c.now()).toBe(50_000 + 660_000);
    c.setNow(5);
    expect(c.now()).toBe(5);
    real += 10;
    expect(c.now()).toBe(5 + 6_000);
  });

  it('defaults origin to real now and scale to 1', () => {
    let real = 123;
    const c = createClock({ realNow: () => real, scale: 0 });
    expect(c.scale).toBe(1);
    real = 200;
    expect(c.now()).toBe(200);
  });

  it('parses local ISO strings', () => {
    expect(parseLocalIso('2026-11-24T11:00:00')).toBe(new Date(2026, 10, 24, 11, 0, 0).getTime());
    expect(parseLocalIso('2026-11-24')).toBe(new Date(2026, 10, 24).getTime());
    expect(parseLocalIso('nope')).toBeUndefined();
    expect(parseLocalIso(undefined)).toBeUndefined();
  });
});
