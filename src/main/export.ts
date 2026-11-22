// Export to Excel and CSV (plan Phase 7, P28). No electron import, so tests can call it directly.
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DaySummary } from '../core/aggregate';
import { categorize } from '../core/categorize';
import { toCsv, type CsvValue } from '../core/csv';
import { fmtHM } from '../core/format';
import { addDays, dateKey, dayStartFromKey, workWindow } from '../core/schedule';
import type { Settings } from '../core/settings';
import { streak } from '../core/streaks';
import { relabelFirefox } from '../core/titlePatterns';
import type { Db } from './db/db';
import * as repo from './db/repo';
import { summaryFor } from './report';

/**
 * `date` cells hold a `YYYY-MM-DD` key; `time`, `time_s` and `datetime` cells hold local epoch ms.
 * Everything else is written as is.
 */
type ColType = 'date' | 'time' | 'time_s' | 'datetime' | 'min' | 'int' | 'text';
type Cell = string | number | null;

export interface Column {
  header: string;
  type: ColType;
  width: number;
}

export interface Sheet {
  name: string;
  columns: Column[];
  rows: Cell[][];
}

export const SHEET_NAMES = [
  'Sessions',
  'Segments',
  'Activity',
  'App-Site summary',
  'Daily summary',
  'Away',
  'Reviews',
  'KPIs',
] as const;

/** Minutes with one decimal, so sums in a spreadsheet stay close to the app's numbers. */
export const minutes = (sec: number) => Math.round(sec / 6) / 10;

const col = (header: string, type: ColType, width?: number): Column => ({
  header,
  type,
  width: width ?? { date: 12, time: 8, time_s: 10, datetime: 17, min: 10, int: 8, text: 14 }[type],
});
/** A duration as two columns: minutes (number) and h:mm (text). */
const durCols = (label: string) => [
  col(`${label} min`, 'min', label.length + 6),
  col(`${label} h:mm`, 'text', label.length + 7),
];
const dur = (sec: number) => [minutes(sec), fmtHM(sec)];

export function buildSheets(db: Db, from: string, to: string, nowMs: number, settings: Settings): Sheet[] {
  const d0 = dayStartFromKey(from);
  const d1 = addDays(dayStartFromKey(to), 1);
  const today = dateKey(nowMs);

  // ---- Sessions ------------------------------------------------------------------
  const sessions = db.all<{
    id: string;
    kind: string;
    name: string | null;
    pname: string | null;
    planned_sec: number | null;
    started_ms: number;
    ended_ms: number | null;
    end_reason: string | null;
    actual_ms: number | null;
  }>(
    `SELECT s.id, s.kind, s.name, p.name AS pname, s.planned_sec, s.started_ms, s.ended_ms, s.end_reason,
            (SELECT SUM(COALESCE(g.end_ms, MAX(g.start_ms, ?)) - g.start_ms) FROM segments g WHERE g.session_id = s.id) AS actual_ms
       FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.started_ms >= ? AND s.started_ms < ? ORDER BY s.started_ms`,
    nowMs,
    d0,
    d1,
  );
  const sessionSheet: Sheet = {
    name: 'Sessions',
    columns: [
      col('Date', 'date'),
      col('Start', 'time'),
      col('End', 'time'),
      col('Kind', 'text', 9),
      col('Name', 'text', 30),
      col('Project', 'text', 16),
      col('Planned min', 'min', 12),
      ...durCols('Actual'),
      col('Overtime min', 'min', 13),
      col('End reason', 'text', 16),
    ],
    rows: sessions.map((s) => {
      const actual = Math.round((s.actual_ms ?? 0) / 1000);
      return [
        dateKey(s.started_ms),
        s.started_ms,
        s.ended_ms,
        s.kind,
        s.name ?? '(unlabelled)',
        s.pname,
        s.planned_sec === null ? null : minutes(s.planned_sec),
        ...dur(actual),
        s.planned_sec === null ? 0 : minutes(Math.max(0, actual - s.planned_sec)),
        s.end_reason,
      ];
    }),
  };

  // ---- Segments ------------------------------------------------------------------
  const segments = db.all<{
    start_ms: number;
    end_ms: number | null;
    source: string;
    kind: string;
    name: string | null;
    pname: string | null;
  }>(
    `SELECT g.start_ms, g.end_ms, g.source, s.kind, s.name, p.name AS pname
       FROM segments g JOIN sessions s ON s.id = g.session_id LEFT JOIN projects p ON p.id = s.project_id
      WHERE g.start_ms >= ? AND g.start_ms < ? ORDER BY g.start_ms`,
    d0,
    d1,
  );
  const segmentSheet: Sheet = {
    name: 'Segments',
    columns: [
      col('Date', 'date'),
      col('Start', 'time_s'),
      col('End', 'time_s'),
      col('Session', 'text', 30),
      col('Kind', 'text', 9),
      col('Project', 'text', 16),
      ...durCols('Length'),
      col('Source', 'text', 13),
    ],
    rows: segments.map((g) => [
      dateKey(g.start_ms),
      g.start_ms,
      g.end_ms,
      g.name ?? '(unlabelled)',
      g.kind,
      g.pname,
      ...dur(Math.round(((g.end_ms ?? Math.max(g.start_ms, nowMs)) - g.start_ms) / 1000)),
      g.source,
    ]),
  };

  // ---- Activity ------------------------------------------------------------------
  const rules = repo.loadRules(db);
  const activity = relabelFirefox(
    db
      .all<{
        start_ms: number;
        end_ms: number;
        exe: string;
        app_name: string;
        title: string | null;
        domain: string | null;
        browser: 'chrome' | 'firefox' | 'edge' | null;
        is_private: number;
      }>(
        'SELECT start_ms, end_ms, exe, app_name, title, domain, browser, is_private FROM activity WHERE start_ms >= ? AND start_ms < ? ORDER BY start_ms, id',
        d0,
        d1,
      )
      .map((r) => ({ ...r, isPrivate: !!r.is_private })),
    repo.loadTitlePatterns(db),
  );
  const activitySheet: Sheet = {
    name: 'Activity',
    columns: [
      col('Date', 'date'),
      col('Start', 'time_s'),
      col('End', 'time_s'),
      col('App', 'text', 16),
      col('Exe', 'text', 16),
      col('Domain', 'text', 22),
      col('Title', 'text', 50),
      col('Category', 'text', 13),
      ...durCols('Length'),
    ],
    rows: activity.map((a) => [
      dateKey(a.start_ms),
      a.start_ms,
      a.end_ms,
      a.app_name,
      a.exe,
      a.domain,
      a.isPrivate ? '(private)' : a.title,
      categorize(a, rules),
      ...dur(Math.round((a.end_ms - a.start_ms) / 1000)),
    ]),
  };

  // ---- Daily summary (and the per-day numbers the App-Site summary adds up) -------
  const cache = new Map<string, DaySummary>();
  const summary = (key: string) => {
    let s = cache.get(key);
    if (!s) cache.set(key, (s = summaryFor(db, key, nowMs, settings)));
    return s;
  };
  const schedule = repo.loadSchedule(db);
  const overrides = repo.loadOverrides(db);
  const streakOn = (key: string) =>
    streak(key, (k) => {
      const scheduled = workWindow(dayStartFromKey(k), schedule, overrides) !== null;
      return { scheduled, goalMet: scheduled && summary(k).goalMet };
    });
  const dates: string[] = [];
  for (let ms = d0; ms < d1 && dateKey(ms) <= today; ms = addDays(ms, 1)) dates.push(dateKey(ms));
  const dailySheet: Sheet = {
    name: 'Daily summary',
    columns: [
      col('Date', 'date'),
      ...durCols('Scheduled'),
      ...durCols('Work'),
      ...durCols('Productive'),
      ...durCols('Break'),
      ...durCols('Distracting'),
      col('Score %', 'int', 9),
      col('Goal met', 'text', 9),
      col('Streak', 'int', 8),
    ],
    rows: dates.map((key) => {
      const s = summary(key);
      return [
        key,
        ...dur(s.scheduledSec),
        ...dur(s.workSec),
        ...dur(s.productiveSec),
        ...dur(s.breakSec),
        ...dur(s.distractingSec),
        s.score === null ? null : Math.round(s.score * 100),
        s.goalMet ? 'Yes' : 'No',
        streakOn(key),
      ];
    }),
  };

  const apps = new Map<string, { category: string; sec: number }>();
  for (const key of dates)
    for (const a of summary(key).apps) {
      const g = apps.get(a.key);
      if (g) g.sec += a.sec;
      else apps.set(a.key, { category: a.category, sec: a.sec });
    }
  const appsTotal = [...apps.values()].reduce((t, a) => t + a.sec, 0);
  const appSheet: Sheet = {
    name: 'App-Site summary',
    columns: [
      col('App or site', 'text', 34),
      col('Category', 'text', 13),
      ...durCols('Time'),
      col('%', 'min', 7),
    ],
    rows: [...apps.entries()]
      .sort((a, b) => b[1].sec - a[1].sec)
      .map(([key, a]) => [
        key,
        a.category,
        ...dur(a.sec),
        appsTotal ? Math.round((a.sec / appsTotal) * 1000) / 10 : 0,
      ]),
  };

  // ---- Away ------------------------------------------------------------------------
  const away = db.all<{
    start_ms: number;
    end_ms: number;
    reason: string;
    classification: string | null;
    label: string | null;
  }>(
    'SELECT start_ms, end_ms, reason, classification, label FROM away_periods WHERE start_ms >= ? AND start_ms < ? ORDER BY start_ms',
    d0,
    d1,
  );
  const awaySheet: Sheet = {
    name: 'Away',
    columns: [
      col('Date', 'date'),
      col('Start', 'time'),
      col('End', 'time'),
      ...durCols('Length'),
      col('Reason', 'text', 12),
      col('Classified as', 'text', 15),
      col('Label', 'text', 24),
    ],
    rows: away.map((a) => [
      dateKey(a.start_ms),
      a.start_ms,
      a.end_ms,
      ...dur(Math.round((a.end_ms - a.start_ms) / 1000)),
      a.reason,
      a.classification ?? 'pending',
      a.label,
    ]),
  };

  // ---- Reviews -----------------------------------------------------------------------
  const reviewDates = db.all<{ date: string; completed_ms: number | null }>(
    `SELECT d.date, r.completed_ms FROM
       (SELECT date FROM reviews WHERE date >= ? AND date <= ? UNION SELECT date FROM review_items WHERE date >= ? AND date <= ?) d
       LEFT JOIN reviews r ON r.date = d.date ORDER BY d.date`,
    from,
    to,
    from,
    to,
  );
  const items = db.all<{ date: string; kind: string; text: string }>(
    'SELECT date, kind, text FROM review_items WHERE date >= ? AND date <= ? ORDER BY date, sort, created_ms',
    from,
    to,
  );
  const joined = (date: string, kind: string) =>
    items
      .filter((i) => i.date === date && i.kind === kind)
      .map((i) => i.text)
      .join(' • ');
  const reviewSheet: Sheet = {
    name: 'Reviews',
    columns: [
      col('Date', 'date'),
      col('Completed', 'datetime'),
      col('Wins', 'text', 60),
      col('Improvements', 'text', 60),
    ],
    rows: reviewDates.map((r) => [r.date, r.completed_ms, joined(r.date, 'win'), joined(r.date, 'improve')]),
  };

  // ---- KPIs (date × KPI) -------------------------------------------------------------
  const values = db.all<{ date: string; kpi_id: string; value: number }>(
    'SELECT date, kpi_id, value FROM kpi_values WHERE date >= ? AND date <= ? ORDER BY date',
    from,
    to,
  );
  const used = new Set(values.map((v) => v.kpi_id));
  const kpis = db
    .all<{ id: string; name: string; unit: string | null; archived: number }>(
      'SELECT id, name, unit, archived FROM kpis ORDER BY sort, name',
    )
    .filter((k) => !k.archived || used.has(k.id));
  const kpiDates = [...new Set(values.map((v) => v.date))];
  const kpiSheet: Sheet = {
    name: 'KPIs',
    columns: [
      col('Date', 'date'),
      ...kpis.map((k) =>
        col(k.unit ? `${k.name} (${k.unit})` : k.name, 'min', Math.max(10, k.name.length + 4)),
      ),
    ],
    rows: kpiDates.map((d) => [
      d,
      ...kpis.map((k) => values.find((v) => v.date === d && v.kpi_id === k.id)?.value ?? null),
    ]),
  };

  return [sessionSheet, segmentSheet, activitySheet, appSheet, dailySheet, awaySheet, reviewSheet, kpiSheet];
}

// ---- writers ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number, s: boolean) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${s ? `:${pad(d.getSeconds())}` : ''}`;
};

/** How a cell reads in a CSV. */
export function csvValue(type: ColType, v: Cell): CsvValue {
  if (v === null) return null;
  if (typeof v === 'number' && (type === 'time' || type === 'time_s')) return hms(v, type === 'time_s');
  if (typeof v === 'number' && type === 'datetime') return `${dateKey(v)} ${hms(v, false)}`;
  return v;
}

/** Excel stores wall-clock values; exceljs reads a Date as UTC, so shift local time into UTC fields. */
const excelDate = (localMs: number) => new Date(localMs - new Date(localMs).getTimezoneOffset() * 60_000);
const keyToExcel = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const NUM_FMT: Partial<Record<ColType, string>> = {
  date: 'yyyy-mm-dd',
  time: 'hh:mm',
  time_s: 'hh:mm:ss',
  datetime: 'yyyy-mm-dd hh:mm',
  min: '0.0',
  int: '0',
};

function xlsxValue(type: ColType, v: Cell): ExcelJS.CellValue {
  if (v === null) return null;
  if (type === 'date' && typeof v === 'string') return keyToExcel(v);
  if ((type === 'time' || type === 'time_s' || type === 'datetime') && typeof v === 'number')
    return excelDate(v);
  return v;
}

export async function writeXlsx(sheets: Sheet[], file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spyder';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({
      header: c.header,
      width: c.width,
      style: NUM_FMT[c.type] ? { numFmt: NUM_FMT[c.type] } : {},
    }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    head.border = { bottom: { style: 'thin', color: { argb: 'FFB8B0D8' } } };
    for (const r of s.rows) ws.addRow(r.map((v, i) => xlsxValue(s.columns[i].type, v)));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  await wb.xlsx.writeFile(file);
}

export const csvFileName = (sheet: string) => `${sheet.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;

export function writeCsvs(sheets: Sheet[], dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return sheets.map((s) => {
    const file = join(dir, csvFileName(s.name));
    writeFileSync(
      file,
      toCsv(
        s.columns.map((c) => c.header),
        s.rows.map((r) => r.map((v, i) => csvValue(s.columns[i].type, v))),
      ),
      'utf8',
    );
    return file;
  });
}

export interface ExportOpts {
  from: string;
  to: string;
  xlsxPath?: string;
  csvDir?: string;
}

export async function exportRange(
  db: Db,
  o: ExportOpts,
  nowMs: number,
  settings: Settings,
): Promise<string[]> {
  const sheets = buildSheets(db, o.from, o.to, nowMs, settings);
  const files: string[] = [];
  if (o.xlsxPath) {
    mkdirSync(dirname(o.xlsxPath), { recursive: true });
    await writeXlsx(sheets, o.xlsxPath);
    files.push(o.xlsxPath);
  }
  if (o.csvDir) files.push(...writeCsvs(sheets, o.csvDir));
  return files;
}
