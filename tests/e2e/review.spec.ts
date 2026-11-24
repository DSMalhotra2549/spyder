// Phase 5: the end-of-day review opens at 17:00, gates on leftovers, persists, and snapshots.
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';

test('review opens at 17:00, gates on leftovers, persists and completes', async () => {
  const s = await launch({ now: '2026-11-24T16:30:00' }); // Tuesday, work 10–17
  try {
    const d = s.dashboard;
    await s.prompt.getByTestId('reminder-start').click();
    await expect.poll(async () => ((await s.debug.state()).host as { engine: { loop: unknown } }).engine.loop).not.toBeNull();
    await s.debug.setNow(new Date('2026-11-24T17:00:05').getTime());
    await expect.poll(async () => (await s.debug.state()).dashboardVisible, { timeout: 10_000 }).toBe(true);
    await expect.poll(() => d.url()).toContain('#/dashboard/review');

    // Leftovers: the blocks 16:30–16:45 and 16:45–17:00 aren't accounted for (P60).
    const complete = d.getByTestId('complete-review');
    const left = d.getByTestId('leftover-block');
    await expect(left).toHaveCount(2);
    await expect(left.first()).toContainText('What did you do 16:30–16:45?');
    await expect(complete).toBeDisabled();
    await expect(d.getByTestId('review-badge')).toHaveText('2');
    await shot(d, 'review-leftovers');

    await left.first().getByLabel('Answer').fill('Planning the week');
    await left.first().getByRole('button', { name: 'Save' }).click();
    await expect(left).toHaveCount(1);
    await left.first().getByTestId('leftover-break').click();
    await expect(d.getByTestId('all-accounted')).toBeVisible();
    await expect(complete).toBeEnabled();
    const named = s.db().prepare('SELECT kind, name FROM sessions ORDER BY started_ms').all();
    expect(named).toEqual([
      { kind: 'open', name: 'Planning the week' },
      { kind: 'break', name: 'Break' },
    ]);

    // A win, an improvement and a KPI value.
    await d.getByTestId('add-win').click();
    await d.keyboard.type('Shipped the review page');
    await d.keyboard.press('Enter'); // saves and adds an empty row
    await d.getByTestId('add-improve').click();
    await d.keyboard.type('Close YouTube first');
    await d.keyboard.press('Tab');
    await d.getByTestId('add-kpi').click();
    await d.getByTestId('kpi-name').fill('Emails answered');
    await d.getByTestId('kpi-unit').fill('emails');
    await d.getByTestId('kpi-unit').press('Enter');
    const kpi = d.locator('[data-testid=kpi-input][data-kpi="Emails answered"]');
    await kpi.fill('14');
    await kpi.press('Enter');
    await expect
      .poll(() => (s.db().prepare('SELECT COUNT(*) AS n FROM kpi_values').get() as { n: number }).n)
      .toBe(1);

    await d.reload();
    await d.getByTestId('bullets-win').waitFor();
    const values = async (kind: string) =>
      d.getByTestId(`bullets-${kind}`).getByTestId('bullet-input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(await values('win')).toEqual(['Shipped the review page']);
    expect(await values('improve')).toEqual(['Close YouTube first']);
    await expect(kpi).toHaveValue('14');

    // KPIs are set up here (P80): Edit renames and removes them; a removed one is archived.
    await d.getByTestId('add-kpi').click();
    await d.getByTestId('kpi-name').fill('Calls made');
    await d.getByTestId('kpi-name').press('Enter');
    await d.getByTestId('kpi-edit').click();
    await expect(d.getByTestId('kpi-edit-row')).toHaveCount(2);
    const nameBox = d.getByTestId('kpi-edit-row').first().getByLabel('KPI name');
    await nameBox.fill('Emails sent');
    await nameBox.press('Enter');
    await expect
      .poll(() => (s.db().prepare("SELECT COUNT(*) AS n FROM kpis WHERE name = 'Emails sent'").get() as { n: number }).n)
      .toBe(1);
    await d.getByRole('button', { name: 'Remove Calls made' }).click();
    await expect(d.getByTestId('kpi-edit-row')).toHaveCount(1);
    expect((s.db().prepare("SELECT archived FROM kpis WHERE name = 'Calls made'").get() as { archived: number }).archived).toBe(1);
    await d.getByTestId('kpi-edit').click();
    await expect(d.locator('[data-testid=kpi-input][data-kpi="Emails sent"]')).toHaveValue('14');

    // Complete → reviews snapshot.
    await complete.click();
    await expect(d.getByTestId('reviewed-chip')).toContainText('Reviewed at 17:00');
    const row = s.db().prepare('SELECT * FROM reviews WHERE date = ?').get('2026-11-24') as Record<string, number>;
    expect(row.completed_ms).toBeGreaterThan(0);
    expect(row.work_sec).toBe(15 * 60);
    expect(row.scheduled_sec).toBe(7 * 3600);
    expect(row.goal_sec).toBe(18_000);
    expect(row.goal_met).toBe(0);
    await d.mouse.move(0, 0);
    await shot(d, 'review');
  } finally {
    await s.close();
  }
});
