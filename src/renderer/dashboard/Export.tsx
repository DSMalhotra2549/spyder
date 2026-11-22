// Export dialog (plan Phase 7): presets, a custom range, then a save dialog in main.
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { addDays, dateKey, dayStartFromKey } from '../../core/schedule';
import { weekStart } from '../../core/trends';
import type { ExportResult } from '../../preload/api';
import { Btn, inputCls } from '../ui/controls';

export type Preset = 'today' | 'week' | 'month' | 'last30' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

export function presetRange(p: Exclude<Preset, 'custom'>, today: string): [string, string] {
  if (p === 'week') return [weekStart(today), today];
  if (p === 'month') return [`${today.slice(0, 7)}-01`, today];
  if (p === 'last30') return [dateKey(addDays(dayStartFromKey(today), -29)), today];
  return [today, today];
}

/** `Export…` button that opens the dialog. */
export function ExportButton({ preset = 'today' }: { preset?: Exclude<Preset, 'custom'> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn data-testid="export-open" onClick={() => setOpen(true)}>
        Export…
      </Btn>
      {open && <ExportDialog initial={preset} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportDialog({ initial, onClose }: { initial: Exclude<Preset, 'custom'>; onClose: () => void }) {
  const [today, setToday] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>(initial);
  const [range, setRange] = useState<[string, string]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  useEffect(() => {
    void window.spyder.getSettings().then((s) => {
      setToday(s.today);
      setRange(presetRange(initial, s.today));
    });
  }, [initial]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (p: Preset) => {
    setPreset(p);
    setResult(null);
    if (p !== 'custom' && today) setRange(presetRange(p, today));
  };
  const [from, to] = range;
  const valid = !!from && !!to && from <= to;
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await window.spyder.exportData({ from, to }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Export"
        data-testid="export-dialog"
        className="w-[480px] rounded-card border border-border bg-surface p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold">Export to Excel / CSV</h2>
        <p className="mt-1 text-[12px] text-muted">
          One .xlsx workbook with 8 sheets, plus each sheet as a CSV file.
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="export-presets">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              data-value={p.value}
              aria-pressed={preset === p.value}
              onClick={() => pick(p.value)}
              className={clsx(
                'h-7 rounded-pill border px-3 text-[12px] font-semibold',
                preset === p.value
                  ? 'border-accent bg-accent/15 text-text'
                  : 'border-border bg-surface-2 text-muted hover:text-text',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            From
            <input
              type="date"
              aria-label="From"
              className={clsx(inputCls, 'w-[150px]')}
              value={from}
              max={today ?? undefined}
              onChange={(e) => {
                setPreset('custom');
                setRange([e.target.value, to]);
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            to
            <input
              type="date"
              aria-label="To"
              className={clsx(inputCls, 'w-[150px]')}
              value={to}
              max={today ?? undefined}
              onChange={(e) => {
                setPreset('custom');
                setRange([from, e.target.value]);
              }}
            />
          </label>
        </div>
        {!valid && from && to && (
          <p className="mt-2 text-[12px] text-orange">The start date is after the end date.</p>
        )}
        {result && 'ok' in result && (
          <div
            data-testid="export-done"
            className="mt-4 rounded-control bg-productive/10 px-3 py-2 text-[12px]"
          >
            Saved <span className="font-semibold">{result.xlsxPath.split(/[\\/]/).pop()}</span> and 8 CSV
            files.{' '}
            <button
              className="text-accent hover:underline"
              onClick={() => void window.spyder.showInFolder(result.xlsxPath)}
            >
              Show in folder
            </button>
          </div>
        )}
        {result && 'error' in result && (
          <p className="mt-4 text-[12px] text-orange">That date range isn’t valid.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            {result && 'ok' in result ? 'Close' : 'Cancel'}
          </Btn>
          <Btn
            variant="primary"
            data-testid="export-run"
            disabled={!valid || busy}
            onClick={() => void run()}
          >
            {busy ? 'Exporting…' : 'Export…'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
