import { describe, expect, it } from 'vitest';
import { T } from './engine.testkit';
import { promptView } from './promptView';
import type { Prompt } from './types';

const p = (type: Prompt['type'], extra: Partial<Prompt> = {}): Prompt => ({
  id: 'p1',
  type,
  sessionId: 's1',
  createdMs: 0,
  ...extra,
});

describe('promptView (§12 copy)', () => {
  it('timeUp', () => {
    const v = promptView(p('timeUp'), 3, { name: 'Replying to emails', elapsedSec: 1800, plannedSec: 1800 });
    expect(v.title).toBe("Time's up: Replying to emails");
    expect(v.body).toBe('Planned 30m. Done, or need more time?');
    expect(v.count).toBe(3);
  });

  it('label and check-in', () => {
    expect(promptView(p('label'), 1, { name: null, elapsedSec: 600, plannedSec: 600 }).title).toBe(
      'What did you do for the last 10m?',
    );
    const un = promptView(p('checkIn'), 1, { name: null, elapsedSec: 1800, plannedSec: null });
    expect(un.title).toBe('What have you been doing for the last 30m?');
    expect(un.labelled).toBe(false);
    const lab = promptView(p('checkIn'), 1, { name: 'Planning', elapsedSec: 3600, plannedSec: null });
    expect(lab.title).toBe('Still on Planning?');
    expect(lab.labelled).toBe(true);
  });

  it('away, recovery, breakEnd', () => {
    const away = promptView(p('away', { awayStartMs: T(11), awayEndMs: T(12, 12) }), 1, null);
    expect(away.title).toBe('You were away 1h 12m');
    expect(away.body).toBe('11:00–12:12');
    expect(promptView(p('recovery', { awayStartMs: T(11), awayEndMs: T(11, 40) }), 1, null).title).toBe(
      "Spyder wasn't running from 11:00 to 11:40",
    );
    expect(promptView(p('breakEnd'), 1, { name: 'Break', elapsedSec: 900, plannedSec: 900 }).title).toBe(
      "Break's over (15m)",
    );
    expect(promptView(p('timeUp'), 1, null).title).toBe("Time's up: Untitled session");
  });
});
