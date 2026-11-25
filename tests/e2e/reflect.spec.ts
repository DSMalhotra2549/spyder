// P98: after a day ends, the prompt asks for its wins and how I'll improve.
import { expect, test } from '@playwright/test';
import { launch, shot, type Launched as Session } from './helpers';

const DAY = '2026-11-24';
// The real defaults the other specs use, but with the midnight card on (its default).
const env = { SPYDER_DEFAULTS: JSON.stringify({ trackFromStartup: false, barPercent: 'day' }) };

type PromptView = { view: string; date?: string } | null;
const promptView = async (s: Session) => ((await s.debug.state()).host as { promptState: PromptView }).promptState;
const items = (s: Session) => s.db().prepare('SELECT kind, text FROM review_items WHERE date = ? ORDER BY kind, sort').all(DAY);

/** Tuesday 16:30: start the loop, let one block end, then cross midnight. */
async function trackThenMidnight(s: Session) {
  await s.prompt.getByTestId('reminder-start').click();
  await expect.poll(async () => ((await s.debug.state()).host as { engine: { loop: unknown } }).engine.loop).not.toBeNull();
  await s.debug.setNow(new Date('2026-11-24T16:50:00').getTime());
  await expect.poll(async () => (await promptView(s))?.view).toBe('account');
  await s.debug.setNow(new Date('2026-11-25T00:00:05').getTime());
}

test('at midnight the card asks about the day that ended; Save writes its wins and improvements', async () => {
  const s = await launch({ now: '2026-11-24T16:30:00', env });
  try {
    await trackThenMidnight(s);
    await expect.poll(async () => (await promptView(s))?.view).toBe('reflect');
    const card = s.prompt.getByTestId('prompt-reflect');
    await expect(card).toContainText('Yesterday');
    await expect(card).toContainText('How did yesterday go?');
    const done = s.prompt.getByTestId('reflect-done');
    await expect(done).toHaveText('Skip');

    // Enter adds the next line.
    const wins = card.getByTestId('reflect-win').getByTestId('reflect-line');
    await wins.first().fill('Shipped the midnight card');
    await expect(done).toHaveText('Save');
    await wins.first().press('Enter');
    await s.prompt.keyboard.type('Fixed the flaky test');
    // P100: the label is "Wins"; + Add adds a line, up to 10 a section.
    await expect(card.getByTestId('reflect-win')).toContainText('Wins');
    await expect(card.getByTestId('reflect-win')).not.toContainText('Today');
    const improve = card.getByTestId('reflect-improve');
    await improve.getByTestId('reflect-line').first().fill('Sleep before midnight');
    await improve.getByTestId('reflect-add').click();
    await s.prompt.keyboard.type('Plan the day the night before');
    await shot(s.prompt, 'prompt-reflect');
    for (let n = 2; n < 10; n++) await improve.getByTestId('reflect-add').click();
    await expect(improve.getByTestId('reflect-line')).toHaveCount(10);
    await expect(improve.getByTestId('reflect-add')).toHaveCount(0);
    await improve.getByTestId('reflect-line').last().fill('Tenth');
    await improve.getByTestId('reflect-line').last().press('Enter'); // full: no 11th line
    await expect(improve.getByTestId('reflect-line')).toHaveCount(10);
    await shot(s.prompt, 'prompt-reflect-full');
    await done.click();

    await expect.poll(() => promptView(s)).toBeNull();
    expect(items(s)).toEqual([
      { kind: 'improve', text: 'Sleep before midnight' },
      { kind: 'improve', text: 'Plan the day the night before' },
      { kind: 'improve', text: 'Tenth' },
      { kind: 'win', text: 'Shipped the midnight card' },
      { kind: 'win', text: 'Fixed the flaky test' },
    ]);

    // The day's Review shows them in its columns.
    const d = s.dashboard;
    await d.evaluate((day) => (location.hash = `#/dashboard/review/${day}`), DAY);
    const values = (kind: string) =>
      d.getByTestId(`bullets-${kind}`).getByTestId('bullet-input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await expect.poll(() => values('win')).toEqual(['Shipped the midnight card', 'Fixed the flaky test']);
    expect(await values('improve')).toEqual(['Sleep before midnight', 'Plan the day the night before', 'Tenth']);

    // Asked once: not again later that night.
    await s.debug.setNow(new Date('2026-11-25T01:00:00').getTime());
    await s.debug.tick();
    expect(await promptView(s)).toBeNull();

    // P99: the next morning, the start reminder and the Block ended card show yesterday's improvements…
    await s.debug.setNow(new Date('2026-11-25T10:00:05').getTime());
    await expect.poll(async () => (await promptView(s))?.view).toBe('reminder');
    const improves = (where: string) => s.prompt.getByTestId(where).getByTestId('prompt-improves');
    await expect(improves('prompt-reminder')).toContainText('Your “How I\'ll improve” from yesterday');
    await expect(improves('prompt-reminder')).toContainText('Sleep before midnight');
    await s.prompt.getByTestId('reminder-start').click();
    await s.debug.setNow(new Date('2026-11-25T10:16:00').getTime());
    await expect.poll(async () => (await promptView(s))?.view).toBe('account');
    await expect(improves('prompt-account')).toContainText('Sleep before midnight');
    await shot(s.prompt, 'prompt-improves');
    // …until the first block of the day is answered.
    await s.prompt.getByLabel('Answer').fill('Planning the day');
    await s.prompt.getByTestId('account-save').click();
    await s.debug.setNow(new Date('2026-11-25T10:31:00').getTime());
    await expect.poll(async () => (await promptView(s))?.view).toBe('account');
    await expect(s.prompt.getByTestId('prompt-account')).toBeVisible();
    await expect(improves('prompt-account')).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test('the setting turns it off; a day with both written is not asked; one written is filled in; Skip keeps it', async () => {
  const s = await launch({ now: '2026-11-24T16:30:00', env });
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.setSettings({ askReflection: false }));
    await trackThenMidnight(s);
    await s.debug.tick();
    expect(await promptView(s)).toBeNull();

    // Both written on Review: not asked even with the setting on.
    const win = await d.evaluate((date) => window.spyder.saveReviewItem({ date, kind: 'win', text: 'Wrote it on Review', sort: 0 }), DAY);
    const imp = await d.evaluate((date) => window.spyder.saveReviewItem({ date, kind: 'improve', text: 'Plan the night before', sort: 0 }), DAY);
    await d.evaluate(() => window.spyder.setSettings({ askReflection: true }));
    await s.debug.tick();
    expect(await promptView(s)).toBeNull();

    // Only a win written: asked, with it filled in. Unchanged, the button skips.
    await d.evaluate((id) => window.spyder.deleteReviewItem(id), imp.id);
    await expect.poll(async () => (await promptView(s))?.view).toBe('reflect');
    const card = s.prompt.getByTestId('prompt-reflect');
    await expect(card.getByTestId('reflect-win').getByTestId('reflect-line')).toHaveValue('Wrote it on Review');
    const done = s.prompt.getByTestId('reflect-done');
    await expect(done).toHaveText('Skip');
    await done.click();
    await expect.poll(() => promptView(s)).toBeNull();
    expect(items(s)).toEqual([{ kind: 'win', text: 'Wrote it on Review' }]);
    expect(s.db().prepare('SELECT date FROM reflections').all()).toEqual([{ date: DAY }]);
    expect(win.id).toBeTruthy();
  } finally {
    await s.close();
  }
});
