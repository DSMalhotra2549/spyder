// Phase 5: the end-of-day review opens at 17:00, gates on leftovers, persists, and snapshots.
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';

test('review opens at 17:00, gates on leftovers, persists and completes', async () => {
  const s = await launch(); // 11:00 Tuesday: BOOT starts an unlabelled open session
  try {
    const d = s.dashboard;
    await s.debug.setNow(new Date('2026-11-24T17:00:05').getTime());
    await expect.poll(async () => (await s.debug.state()).dashboardVisible, { timeout: 10_000 }).toBe(true);
    await expect.poll(() => d.url()).toContain('#/dashboard/review');

    // Leftover: the 11:00–17:00 open session has no label.
    const complete = d.getByTestId('complete-review');
    await expect(d.getByTestId('leftover-session')).toHaveCount(1);
    await expect(complete).toBeDisabled();
    await expect(d.getByTestId('review-badge')).toHaveText('1');
    await shot(d, 'review-leftovers');

    await d.getByTestId('leftover-session').locator('input').first().fill('Planning the week');
    await d.getByTestId('leftover-session').getByRole('button', { name: 'Save' }).click();
    await expect(d.getByTestId('all-accounted')).toBeVisible();
    await expect(complete).toBeEnabled();
    const named = s.db().prepare("SELECT name FROM sessions WHERE kind = 'open' ORDER BY started_ms").all() as { name: string }[];
    expect(named[0].name).toBe('Planning the week');

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

    // Complete → reviews snapshot.
    await complete.click();
    await expect(d.getByTestId('reviewed-chip')).toContainText('Reviewed at 17:00');
    const row = s.db().prepare('SELECT * FROM reviews WHERE date = ?').get('2026-11-24') as Record<string, number>;
    expect(row.completed_ms).toBeGreaterThan(0);
    expect(row.work_sec).toBe(6 * 3600);
    expect(row.scheduled_sec).toBe(7 * 3600);
    expect(row.goal_sec).toBe(18_000);
    expect(row.goal_met).toBe(1);
    await d.mouse.move(0, 0);
    await shot(d, 'review');
  } finally {
    await s.close();
  }
});
