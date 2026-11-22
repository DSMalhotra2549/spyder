import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('escapes text that would run as a formula', () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=a,b')).toBe(`"'=a,b"`);
    expect(csvCell('\t=1+1')).toBe("'\t=1+1");
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
    // Numbers are numbers, not text: a negative stays as is.
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes empty cells for null, undefined and non-finite numbers', () => {
    expect([null, undefined, NaN, true, false, 1.5].map(csvCell)).toEqual([
      '',
      '',
      '',
      'TRUE',
      'FALSE',
      '1.5',
    ]);
  });

  it('round-trips through parseCsv, BOM and CRLF included', () => {
    const rows = [
      ['Zoë 🚀 日本語', 'a,"b"', 'multi\r\nline'],
      ['', 'x', 'y'],
    ];
    const text = toCsv(['h1', 'h2', 'h3'], rows);
    expect(text.startsWith('﻿h1,h2,h3\r\n')).toBe(true);
    expect(parseCsv(text)).toEqual([['h1', 'h2', 'h3'], ...rows]);
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
