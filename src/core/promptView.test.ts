import { describe, expect, it } from 'vitest';
import { T } from './engine.testkit';
import { accountView, reminderView } from './promptView';

const blk = (h: number, m: number, extra = {}) => ({ id: `b${h}${m}`, startMs: T(h, m), endMs: T(h, m + 15), awaySec: 0, apps: [], ...extra });

describe('prompt copy (P59, P60)', () => {
  it('one block asks about its time range, with away minutes and apps as hints', () => {
    const v = accountView([blk(10, 7, { awaySec: 9 * 60, apps: ['Code', 'github.com'] })], 'Emails', false);
    expect(v.heading).toBe('Block ended');
    expect(v.title).toBe('What did you do 10:07–10:22?');
    expect(v.blocks[0]).toMatchObject({ range: '10:07–10:22', length: '15m', hint: 'Away 9m · Code, github.com' });
    expect(v.lastAnswer).toBe('Emails');
  });

  it('several blocks share one prompt; under a minute away is no hint', () => {
    const v = accountView([blk(10, 0, { awaySec: 30 }), blk(10, 15)], null, true);
    expect(v.heading).toBe('2 blocks');
    expect(v.title).toBe('What did you do in these 2 blocks?');
    expect(v.blocks.map((b) => b.hint)).toEqual([null, null]);
    expect(v.canContinue).toBe(true);
  });

  it('the start reminder names the block length', () => {
    expect(reminderView(900)).toMatchObject({ heading: 'Not started', title: 'Work hours have started', body: 'Press Start to begin 15m blocks.' });
  });
});
