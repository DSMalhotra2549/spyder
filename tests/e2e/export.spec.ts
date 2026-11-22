// Phase 7: export 14 seeded days to .xlsx + CSV and read them back.
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../src/core/csv';
import { addDays, dateKey, dayStartFromKey } from '../../src/core/schedule';
import { Db } from '../../src/main/db/db';
import { buildSheets, csvFileName, csvValue, minutes, SHEET_NAMES } from '../../src/main/export';
import { summaryFor } from '../../src/main/report';
import { loadSettings } from '../../src/main/settings';
import { freshDataDir, launch, seed, shot } from './helpers';

const FROM = '2026-11-11';
const TO = '2026-11-24';
const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).getTime();
const EVIL = "=cmd|' /C calc'!A0";
const INTL = 'Zoë 🚀 日本語のページ — Привет';

test('export: 7 sheets (P50), counts and minutes match the DB, CSVs round-trip', async () => {
  const dir = freshDataDir();
  seed(dir, 14, TO);
  {
    const db = new Db(join(dir, 'spyder.db'));
    db.run(
      "INSERT INTO sessions (id, kind, name, status, started_ms, ended_ms, elapsed_sec, end_reason, created_ms) VALUES ('evil', 'open', ?, 'done', ?, ?, 600, 'done', ?)",
      EVIL, at(17, 30), at(17, 40), at(17, 30),
    );
    db.run("INSERT INTO segments (id, session_id, start_ms, end_ms) VALUES ('evil-g', 'evil', ?, ?)", at(17, 30), at(17, 40));
    db.run(
      "INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, 'notepad.exe', 'Notepad', ?, NULL, NULL, 0)",
      at(17, 30), at(17, 40), INTL,
    );
    db.close();
  }
  const out = join(dir, 'out');
  const xlsxPath = join(out, 'export.xlsx');
  const s = await launch({ dataDir: dir, now: `${TO}T18:00:00`, env: { SPYDER_EXPORT_PATH: xlsxPath } });
  let nowMs: number;
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await d.getByTestId('export-open').click();
    const dlg = d.getByTestId('export-dialog');
    // Presets fill the range.
    await dlg.locator('[data-value=week]').click();
    await expect(dlg.getByLabel('From')).toHaveValue('2026-11-23');
    await dlg.locator('[data-value=last30]').click();
    await expect(dlg.getByLabel('From')).toHaveValue('2026-10-26');
    // Custom range = the 14 seeded days.
    await dlg.getByLabel('From').fill(FROM);
    await expect(dlg.locator('[data-value=custom]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByLabel('To')).toHaveValue(TO);
    await dlg.getByTestId('export-run').click();
    await expect(dlg.getByTestId('export-done')).toBeVisible();
    await dlg.screenshot({ path: join(__dirname, '__shots__', 'export-dialog.png') });
    await shot(d, 'export-settings');
    nowMs = (await s.debug.state()).now as number;
  } finally {
    await s.close();
  }

  const db = new Db(join(dir, 'spyder.db'));
  try {
    const settings = loadSettings(db);
    const d0 = dayStartFromKey(FROM);
    const d1 = addDays(dayStartFromKey(TO), 1);
    const count = (table: string, colName: string) =>
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${colName} >= ? AND ${colName} < ?`, d0, d1)!.n;
    const sheets = buildSheets(db, FROM, TO, nowMs, settings);

    // ---- xlsx --------------------------------------------------------------------
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...SHEET_NAMES]);
    for (const sh of sheets) {
      const ws = wb.getWorksheet(sh.name)!;
      expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(sh.columns.map((c) => c.header));
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.rowCount - 1).toBe(sh.rows.length);
    }
    const sessions = wb.getWorksheet('Sessions')!;
    const activity = wb.getWorksheet('Activity')!;
    expect(sessions.rowCount - 1).toBe(count('sessions', 'started_ms'));
    expect(activity.rowCount - 1).toBe(count('activity', 'start_ms'));
    expect(count('sessions', 'started_ms')).toBeGreaterThan(14);
    // Dates are real Excel dates; the stored text is untouched in the workbook.
    expect(sessions.getCell('A2').value).toBeInstanceOf(Date);
    expect(sessions.getCell('A2').numFmt).toBe('yyyy-mm-dd');
    const names: unknown[] = [];
    sessions.getColumn(5).eachCell((c) => names.push(c.value));
    expect(names).toContain(EVIL);
    const titles: unknown[] = [];
    activity.getColumn(7).eachCell((c) => titles.push(c.value));
    expect(titles).toContain(INTL);

    // Daily summary minutes = daySummary, for each of the 14 days.
    const daily = wb.getWorksheet('Daily summary')!;
    expect(daily.rowCount - 1).toBe(14);
    const head = (daily.getRow(1).values as string[]).slice(1);
    const at_ = (h: string) => head.indexOf(h) + 1;
    for (let i = 0; i < 14; i++) {
      const key = dateKey(addDays(d0, i));
      const row = daily.getRow(i + 2);
      const sum = summaryFor(db, key, nowMs, settings);
      expect(row.getCell(1).value).toEqual(new Date(`${key}T00:00:00Z`));
      expect(row.getCell(at_('Scheduled min')).value).toBe(minutes(sum.scheduledSec));
      expect(row.getCell(at_('Work min')).value).toBe(minutes(sum.workSec));
      expect(row.getCell(at_('Productive min')).value).toBe(minutes(sum.productiveSec));
      expect(row.getCell(at_('Break min')).value).toBe(minutes(sum.breakSec));
      expect(row.getCell(at_('Distracting min')).value).toBe(minutes(sum.distractingSec));
      expect(row.getCell(at_('Goal met')).value).toBe(sum.goalMet ? 'Yes' : 'No');
    }
    // Reviews and KPIs have data from the seed.
    expect(wb.getWorksheet('Reviews')!.rowCount).toBeGreaterThan(1);
    expect(wb.getWorksheet('KPIs')!.columnCount).toBeGreaterThan(1);

    // ---- CSV ---------------------------------------------------------------------
    const csvDir = join(out, 'export (CSV)');
    const escape = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    for (const sh of sheets) {
      const text = readFileSync(join(csvDir, csvFileName(sh.name)), 'utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const expected = [
        sh.columns.map((c) => c.header),
        ...sh.rows.map((r) =>
          r.map((v, i) => {
            const c = csvValue(sh.columns[i].type, v);
            return c === null || c === undefined ? '' : typeof c === 'string' ? escape(c) : String(c);
          }),
        ),
      ];
      expect(parseCsv(text)).toEqual(expected);
    }
    const csvSessions = parseCsv(readFileSync(join(csvDir, 'sessions.csv'), 'utf8'));
    expect(csvSessions.some((r) => r[4] === `'${EVIL}`)).toBe(true);
    expect(csvSessions.some((r) => r[4] === EVIL)).toBe(false);
    const csvActivity = parseCsv(readFileSync(join(csvDir, 'activity.csv'), 'utf8'));
    expect(csvActivity.some((r) => r[6] === INTL)).toBe(true);
  } finally {
    db.close();
  }
});
