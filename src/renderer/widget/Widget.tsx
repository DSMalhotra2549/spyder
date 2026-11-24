// Floating widget (design/DESIGN.md §2): the bar is the only widget (P43, P49, P50); it counts up within the block (P63).
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { fmtClock, fmtDuration } from '../../core/format';
import type { WidgetPayload } from '../../preload/api';

function useWidget(): WidgetPayload | null {
  const [w, setW] = useState<WidgetPayload | null>(null);
  useEffect(() => {
    void window.spyder.getWidget().then(setW);
    return window.spyder.onWidget(setW);
  }, []);
  return w;
}

export function Widget() {
  const w = useWidget();
  if (!w) return null;
  return (
    <div className="flex flex-col items-start p-2">
      <Bar w={w} />
    </div>
  );
}

function offHoursLine(w: WidgetPayload): string {
  if (w.isDayOff) return 'Day off';
  return w.workdayPct >= 100 ? 'Workday done' : 'Before work hours';
}

// ---- Bar (P43) ----------------------------------------------------------------------------
// Rize-style status strip: three metrics with two-line caps labels, then a ☰ segment.

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `23 min` under an hour, `2h 14m` above (the reference shows minutes). */
function fmtBarMin(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

function barCaption(w: WidgetPayload): [string, string] {
  if (w.mode === 'off_hours' && !w.running) {
    const line = offHoursLine(w);
    const i = line.indexOf(' ');
    return [line.slice(0, i), line.slice(i + 1)];
  }
  if (w.notStarted) return ['Press Start', 'in Spyder'];
  if (w.isDistracted) return ['Distracted', w.distractTarget ?? ''];
  return ['Block', `of ${fmtDuration(w.blockLengthSec)}`];
}

function Caps({ lines, className }: { lines: [string, string]; className?: string }) {
  return (
    <span className={clsx('caps max-w-[88px] min-w-0 text-left tracking-[.04em]', className ?? 'text-muted')}>
      <span className="block truncate">{lines[0]}</span>
      <span className="block truncate">{lines[1]}</span>
    </span>
  );
}

/**
 * Bar (P43, P49, P63): sharp corners, no panel. The left button opens the dashboard on Today; the
 * cells do nothing on click; everything but the buttons drags; – hides the bar. Not started is
 * highlighted (P59).
 */
function Bar({ w }: { w: WidgetPayload }) {
  const red = w.isDistracted;
  const met = w.productiveTodaySec >= w.goalSec;
  // Cells are content-sized and spread evenly (P49); they're inert and drag like the gaps.
  const cell = 'flex min-w-0 items-center gap-2';
  return (
    <div
      data-testid="pill"
      data-style="bar"
      data-state={w.running ? 'running' : w.notStarted ? 'not-started' : 'off'}
      className={clsx(
        'drag relative flex h-[34px] w-[512px] items-stretch overflow-hidden border',
        red ? 'border-red' : w.notStarted ? 'border-orange' : 'border-border-strong',
        w.isDistracted
          ? 'distracted bg-[color-mix(in_srgb,var(--color-red)_14%,var(--color-surface))]'
          : w.notStarted
            ? 'bg-[color-mix(in_srgb,var(--color-orange)_12%,var(--color-surface))]'
            : 'bg-surface',
      )}
    >
      <button
        type="button"
        aria-label="Open dashboard"
        title="Open dashboard"
        onClick={() => void window.spyder.openDashboard('today')}
        className="no-drag flex w-8 shrink-0 cursor-pointer items-center justify-center border-r border-border-strong bg-surface-2/60 text-muted outline-none hover:text-text"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          {[0, 7].flatMap((x) => [0, 7].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="5" height="5" rx="1" fill="currentColor" />))}
        </svg>
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-around px-1">
        <div data-testid="pill-body" className={clsx(cell, 'relative')}>
          {w.running ? (
            <span data-testid="timer" className={clsx('tabular text-[19px] leading-none font-bold whitespace-nowrap', red ? 'text-red' : 'text-text')}>
              {fmtClock(w.timerSec)}
            </span>
          ) : (
            <span data-testid="bar-status" className={clsx('text-[15px] font-semibold whitespace-nowrap', w.notStarted ? 'text-orange' : 'text-muted')}>
              {w.notStarted ? 'Not started' : 'Off hours'}
            </span>
          )}
          <Caps lines={barCaption(w)} className={red ? 'text-red' : w.notStarted ? 'text-orange' : undefined} />
          {w.pendingCount > 0 && <span data-testid="prompt-dot" className="absolute top-0 -right-1 h-1.5 w-1.5 rounded-full bg-orange" />}
        </div>
        <div data-testid="bar-productive" className={cell}>
          <span className={clsx('tabular text-[19px] leading-none font-bold whitespace-nowrap', met ? 'text-green' : 'text-accent')}>
            {fmtBarMin(w.productiveTodaySec)}
          </span>
          <Caps lines={['Productive', 'today']} />
        </div>
        <div data-testid="bar-day" className={cell}>
          <span className="tabular text-[19px] leading-none font-bold whitespace-nowrap">
            {w.goalPct ? `${Math.round((w.productiveTodaySec / w.goalSec) * 100)}%` : w.isDayOff ? '–' : `${Math.round(w.workdayPct)}%`}
          </span>
          <Caps lines={['Percent', w.goalPct ? 'of goal' : 'of day']} />
        </div>
      </div>
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize (tray or hotkey brings it back)"
        onClick={() => void window.spyder.hideWidget()}
        className="no-drag flex w-8 shrink-0 cursor-pointer items-center justify-center border-l border-border-strong text-muted outline-none hover:text-text"
      >
        <svg width="10" height="2" viewBox="0 0 10 2" aria-hidden>
          <path d="M0 1h10" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div
        data-testid="drag-handle"
        title="Drag to move"
        className="flex w-6 shrink-0 cursor-move items-center justify-center border-l border-border-strong bg-surface-2/60 text-faint"
      >
        <svg width="6" height="14" viewBox="0 0 6 14" aria-hidden>
          {[1.5, 7, 12.5].flatMap((y) => [
            <circle key={`a${y}`} cx="1.2" cy={y} r="1.1" fill="currentColor" />,
            <circle key={`b${y}`} cx="4.8" cy={y} r="1.1" fill="currentColor" />,
          ])}
        </svg>
      </div>
    </div>
  );
}
