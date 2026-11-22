// CSV export (plan Phase 7): RFC 4180 quoting, UTF-8 BOM, and formula-injection escaping.

export type CsvValue = string | number | boolean | null | undefined;

/** Text starting with one of these (OWASP list, incl. tab and CR) could run as a formula; it gets a leading `'`. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Whole file: BOM, header, rows; CRLF line breaks as RFC 4180 asks. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 reader (for tests and round-trip checks). Strips a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
