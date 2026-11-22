// Floating widget (plan §12, design/DESIGN.md §2): Bar, Full and Compact styles (P31, P43, P46), expanded panel, hover card.
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { fmtClock, fmtDuration, fmtHM } from '../../core/format';
import type { Kind } from '../../core/types';
import type { WidgetPayload } from '../../preload/api';
import { Btn } from '../ui/controls';
import { playChime } from './ring';

const KIND_COLOR: Record<Kind, string> = {
  planned: 'var(--color-planned)',
  timed: 'var(--color-timed)',
  open: 'var(--color-open)',
  break: 'var(--color-break)',
};

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
  const [expanded, setExpanded] = useState(false);
  // Compact hover card appears after 300 ms of hovering (DESIGN.md §2).
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const style = w?.style;
  const hover = hovered && !expanded && style === 'compact';

  useEffect(() => window.spyder.onRing(playChime), []);
  useEffect(() => {
    if (style) void window.spyder.widgetLayout(expanded ? 'expanded' : hover ? 'hover' : 'collapsed');
  }, [expanded, hover, style]);
  useEffect(() => {
    const collapse = () => setExpanded(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && collapse();
    window.addEventListener('blur', collapse);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('blur', collapse);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const enter = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), 300);
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  if (!w) return null;
  const toggle = () => setExpanded((x) => !x);
  return (
    <div className="flex flex-col items-start gap-2 p-2" onMouseLeave={leave}>
      {w.style === 'bar' ? (
        <Bar w={w} />
      ) : w.style === 'full' ? (
        <FullPill w={w} onToggle={toggle} />
      ) : (
        <CompactPill w={w} onToggle={toggle} onEnter={enter} />
      )}
      {hover && <HoverCard w={w} />}
      {expanded && <Panel w={w} onCollapse={() => setExpanded(false)} />}
    </div>
  );
}

// ---- shared pieces ------------------------------------------------------------------

/** Rounded-rect path starting bottom-left, running clockwise (Rize-style progress stroke). */
function pillPath(w: number, h: number, inset: number): string {
  const r = h / 2 - inset;
  const x0 = inset + r;
  const x1 = w - inset - r;
  return `M ${x0} ${h - inset} A ${r} ${r} 0 0 1 ${x0} ${inset} L ${x1} ${inset} A ${r} ${r} 0 0 1 ${x1} ${h - inset} Z`;
}

function ProgressStroke({ w, width, height }: { w: WidgetPayload; width: number; height: number }) {
  const red = w.isOvertime || w.isDistracted;
  const progress = red ? 1 : w.mode === 'working' && w.kind && w.kind !== 'open' && w.progress !== null ? w.progress : 0;
  if (progress <= 0) return null;
  const color = red ? 'var(--color-red)' : KIND_COLOR[w.kind!];
  return (
    <svg className="pointer-events-none absolute top-[-1.5px] left-[-1.5px]" width={width} height={height}>
      <path
        d={pillPath(width, height, 1)}
        fill="none"
        stroke={color}
        strokeWidth={2}
        pathLength={100}
        strokeDasharray={`${progress * 100} 100`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function WorkdayRing({ w, size, stroke, font }: { w: WidgetPayload; size: number; stroke: number; font: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = w.isDayOff ? 0 : w.workdayPct;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${Math.round(pct)}% of day`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="tabular absolute inset-0 flex items-center justify-center font-bold" style={{ fontSize: font }}>
        {w.isDayOff ? '–' : Math.round(pct)}
      </div>
      {w.hasPrompt && (
        <span data-testid="prompt-dot" className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-orange" />
      )}
    </div>
  );
}

function StateMarker({ w }: { w: WidgetPayload }) {
  if (w.mode !== 'working' || !w.kind || w.kind === 'open') return null;
  return <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: KIND_COLOR[w.kind] }} />;
}

const timerText = (w: WidgetPayload) => (w.isOvertime ? `+${fmtClock(w.overtimeSec)}` : fmtClock(w.timerSec));

function offHoursLine(w: WidgetPayload): string {
  if (w.isDayOff) return 'Day off';
  return w.workdayPct >= 100 ? 'Workday done' : 'Before work hours';
}

function ProductiveText({ w, suffix }: { w: WidgetPayload; suffix: string }) {
  const met = w.productiveTodaySec >= w.goalSec;
  return (
    <span className={clsx(met && 'text-green')}>
      {fmtHM(w.productiveTodaySec)} / {fmtHM(w.goalSec)} {suffix}
    </span>
  );
}

function KeepWorkingChip({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void window.spyder.keepWorking();
      }}
      className={clsx(
        'no-drag h-5 items-center rounded-pill border border-accent px-2 text-[10px] font-semibold text-text hover:bg-accent/20',
        className,
      )}
    >
      Keep working +30
    </button>
  );
}

const pillCls = (w: WidgetPayload) =>
  clsx(
    'drag group relative flex items-center rounded-pill border-[1.5px] shadow-[var(--shadow-float)]',
    w.isDistracted ? 'distracted border-red' : w.isOvertime ? 'border-red' : 'border-border-strong',
    w.isDistracted ? 'bg-[color-mix(in_srgb,#f04452_18%,var(--color-surface))]' : 'bg-surface',
  );

// ---- Full style ---------------------------------------------------------------------

function FullPill({ w, onToggle }: { w: WidgetPayload; onToggle: () => void }) {
  const off = w.mode === 'off_hours';
  const away = w.mode === 'away';
  return (
    <div data-testid="pill" data-style="full" className={clsx(pillCls(w), 'h-16 w-80 gap-3 px-4')}>
      <ProgressStroke w={w} width={320} height={64} />
      <div className="flex min-w-[68px] shrink-0 items-center gap-2">
        <StateMarker w={w} />
        {off || away ? (
          <span className="text-[15px] font-semibold text-muted">{off ? 'Off hours' : 'Away'}</span>
        ) : (
          <span
            data-testid="timer"
            className={clsx('tabular text-[22px] leading-none font-bold', w.isOvertime && 'text-red')}
          >
            {timerText(w)}
          </span>
        )}
      </div>
      {/* A div, not a button: it can contain the Keep-working chip button. */}
      <div
        role="button"
        tabIndex={-1}
        data-testid="pill-body"
        onClick={onToggle}
        className="no-drag flex min-w-0 flex-1 cursor-default flex-col gap-[3px] text-left"
      >
        <div
          data-testid="title"
          className={clsx(
            'truncate text-[13px] leading-tight font-semibold',
            off && 'text-muted',
            w.isUnlabelled && 'font-normal text-muted italic',
          )}
        >
          {w.isDistracted && '⚠ '}
          {off ? offHoursLine(w) : w.title}
        </div>
        <div className="h-1 overflow-hidden rounded-bar bg-surface-2">
          <div
            className={clsx('h-full rounded-bar', w.workdayPct > 50 ? 'bg-accent' : 'bg-muted')}
            style={{ width: `${w.workdayPct}%` }}
          />
        </div>
        <div className="caps flex flex-col gap-px text-muted" data-testid="caption">
          {off ? (
            <ProductiveText w={w} suffix="productive today" />
          ) : (
            <>
              <span className="truncate">
                {w.isPaused ? `Paused · ${w.pausedName}` : `${Math.round(w.workdayPct)}% of day`}
              </span>
              <ProductiveText w={w} suffix="productive" />
            </>
          )}
        </div>
      </div>
      <div className="no-drag">
        <WorkdayRing w={w} size={34} stroke={3} font={11} />
      </div>
    </div>
  );
}

// ---- Compact style --------------------------------------------------------------------

function compactCaption(w: WidgetPayload): [string, string] {
  if (w.mode !== 'working' || !w.kind) return ['Tracking', 'Status'];
  if (w.isOvertime) return ['Overtime', w.title];
  const remaining = w.kind !== 'open' && w.plannedSec !== null && !(w.kind === 'planned' && w.direction === 'up');
  const label = { planned: 'Planned', timed: 'Timed', open: 'Session', break: w.isPaused ? 'Paused' : 'Break' }[w.kind];
  return [label, remaining ? 'Remaining' : 'Elapsed'];
}

function CompactPill({ w, onToggle, onEnter }: { w: WidgetPayload; onToggle: () => void; onEnter: () => void }) {
  const off = w.mode === 'off_hours';
  const away = w.mode === 'away';
  const [l1, l2] = compactCaption(w);
  return (
    <div
      data-testid="pill"
      data-style="compact"
      onMouseEnter={onEnter}
      className={clsx(pillCls(w), 'h-10 w-44 gap-1.5 pr-1.5 pl-3')}
    >
      <ProgressStroke w={w} width={176} height={40} />
      <StateMarker w={w} />
      <button
        type="button"
        data-testid="pill-body"
        onClick={onToggle}
        className="no-drag flex min-w-0 flex-1 cursor-default items-center gap-1.5 text-left"
      >
        {off || away ? (
          <span className="text-[13px] font-semibold whitespace-nowrap text-muted">{off ? 'Off hours' : 'Away'}</span>
        ) : (
          <span
            data-testid="timer"
            className={clsx('tabular text-[18px] leading-none font-bold', w.isOvertime && 'text-red')}
          >
            {timerText(w)}
          </span>
        )}
        <span className={clsx('caps min-w-0 tracking-[.03em]', w.isOvertime ? 'text-red' : 'text-muted')}>
          <span className="block truncate">{l1}</span>
          <span className="block truncate">{l2}</span>
        </span>
      </button>
      <div className="no-drag">
        <WorkdayRing w={w} size={26} stroke={2.5} font={9} />
      </div>
    </div>
  );
}

function HoverCard({ w }: { w: WidgetPayload }) {
  const off = w.mode === 'off_hours';
  return (
    <div
      data-testid="hover-card"
      className="flex w-60 flex-col gap-1.5 rounded-card border border-border-strong bg-surface p-3 shadow-[var(--shadow-float)]"
    >
      <div className={clsx('truncate text-[13px] font-semibold', w.isUnlabelled && 'font-normal text-muted italic')}>
        {off ? offHoursLine(w) : w.title}
      </div>
      <div className="h-1 overflow-hidden rounded-bar bg-surface-2">
        <div
          className={clsx('h-full rounded-bar', w.workdayPct > 50 ? 'bg-accent' : 'bg-muted')}
          style={{ width: `${w.workdayPct}%` }}
        />
      </div>
      <div className="text-[12px] text-muted">{Math.round(w.workdayPct)}% of day</div>
      <div className="text-[12px] text-muted">
        <ProductiveText w={w} suffix="productive" />
      </div>
      {w.isPaused && <div className="text-[12px] text-break">Paused: {w.pausedName}</div>}
      {w.isDistracted && w.distractTarget && (
        <div className="text-[12px] text-red">
          On {w.distractTarget} for {fmtDuration(w.distractSec).replace(/m$/, ' min')}
        </div>
      )}
      {off && <KeepWorkingChip className="inline-flex self-start" />}
    </div>
  );
}

// ---- Bar style (P43) ----------------------------------------------------------------------
// Rize-style status strip: three metrics with two-line caps labels, then a ☰ segment.

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `23 min` under an hour, `2h 14m` above (the reference shows minutes). */
function fmtBarMin(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

function barCaption(w: WidgetPayload): [string, string] {
  if (w.mode === 'off_hours') {
    const line = offHoursLine(w);
    const i = line.indexOf(' ');
    return [line.slice(0, i), line.slice(i + 1)];
  }
  if (w.mode === 'away') return ['Away from', 'computer'];
  if (w.isDistracted) return ['Distracted', w.distractTarget ?? w.title];
  return compactCaption(w);
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
 * Bar (P43, P46): sharp corners, no panel. Each cell opens the dashboard on Today; the gaps and
 * the ⋮⋮ handle drag; – hides the bar.
 */
function Bar({ w }: { w: WidgetPayload }) {
  const off = w.mode === 'off_hours';
  const away = w.mode === 'away';
  const red = w.isOvertime || w.isDistracted;
  const met = w.productiveTodaySec >= w.goalSec;
  const openToday = () => void window.spyder.openDashboard('today');
  // Fixed slots (P43 spacing): the slot is drag area, only the content inside is the click target.
  const cell = 'no-drag flex min-w-0 cursor-pointer items-center gap-2 outline-none';
  return (
    <div
      data-testid="pill"
      data-style="bar"
      className={clsx(
        'drag relative flex h-[34px] w-[468px] items-stretch overflow-hidden border',
        red ? 'border-red' : 'border-border-strong',
        w.isDistracted ? 'distracted bg-[color-mix(in_srgb,#f04452_14%,var(--color-surface))]' : 'bg-surface',
      )}
    >
      <div className="flex w-[160px] shrink-0 items-center justify-center px-2">
        <button type="button" data-testid="pill-body" onClick={openToday} className={clsx(cell, 'relative')}>
          {off || away ? (
            <span className="text-[15px] font-semibold whitespace-nowrap text-muted">{off ? 'Off hours' : 'Away'}</span>
          ) : (
            <span
              data-testid="timer"
              className={clsx(
                'tabular text-[19px] leading-none font-bold whitespace-nowrap',
                red ? 'text-red' : w.isPaused ? 'text-break' : 'text-text',
              )}
            >
              {timerText(w)}
            </span>
          )}
          {w.label !== null ? (
            <span
              data-testid="bar-label"
              title={w.label}
              className={clsx(
                'line-clamp-2 min-w-0 text-left text-[12px] leading-[14px] font-semibold [overflow-wrap:anywhere]',
                red ? 'text-red' : w.isPaused ? 'text-break' : 'text-muted',
              )}
            >
              {w.label}
            </span>
          ) : (
            <Caps lines={barCaption(w)} className={red ? 'text-red' : undefined} />
          )}
          {w.hasPrompt && (
            <span data-testid="prompt-dot" className="absolute top-0 -right-1 h-1.5 w-1.5 rounded-full bg-orange" />
          )}
        </button>
      </div>
      <div className="flex flex-[1.25] items-center justify-center">
        <button type="button" data-testid="bar-productive" onClick={openToday} className={cell}>
          <span className={clsx('tabular text-[19px] leading-none font-bold whitespace-nowrap', met ? 'text-green' : 'text-accent')}>
            {fmtBarMin(w.productiveTodaySec)}
          </span>
          <Caps lines={['Productive', 'today']} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <button type="button" data-testid="bar-day" onClick={openToday} className={cell}>
          <span className="tabular text-[19px] leading-none font-bold whitespace-nowrap">
            {w.isDayOff ? '–' : `${Math.round(w.workdayPct)}%`}
          </span>
          <Caps lines={['Percent', 'of day']} />
        </button>
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

// ---- Expanded panel ---------------------------------------------------------------------

function Panel({ w, onCollapse }: { w: WidgetPayload; onCollapse: () => void }) {
  const working = w.mode === 'working';
  const timed = working && w.plannedSec !== null && w.kind !== 'open';
  const act = (fn: () => unknown) => () => {
    void fn();
  };
  // ⇄ cycles compact → full → bar → compact.
  const next = ({ compact: 'full', full: 'bar', bar: 'compact' } as const)[w.style];
  return (
    <div
      data-testid="panel"
      className="flex w-80 flex-col gap-2 rounded-card border border-border-strong bg-surface p-3 shadow-[var(--shadow-float)]"
    >
      <div className="flex gap-1.5">
        <Btn variant="primary" disabled={w.mode === 'away'} onClick={act(() => window.spyder.openStart())}>
          ▶ Start
        </Btn>
        {w.mode === 'off_hours' ? (
          <Btn variant="outline" onClick={act(() => window.spyder.keepWorking())}>
            Keep working +30
          </Btn>
        ) : (
          <>
            <Btn disabled={!working} onClick={act(() => window.spyder.done())}>
              ✓ Done
            </Btn>
            <Btn disabled={!timed} onClick={act(() => window.spyder.extend(300))}>
              +5
            </Btn>
            <Btn disabled={!timed} onClick={act(() => window.spyder.extend(900))}>
              +15
            </Btn>
          </>
        )}
      </div>
      <div className="flex gap-1.5">
        {w.isPaused ? (
          <Btn variant="outline" onClick={act(() => window.spyder.resume())}>
            ▶ Resume
          </Btn>
        ) : (
          <Btn disabled={!working || w.kind === 'break'} onClick={act(() => window.spyder.pause())}>
            ⏸ Pause
          </Btn>
        )}
        <Btn disabled={w.mode === 'away'} onClick={act(() => window.spyder.openStart('break'))}>
          Break
        </Btn>
        <Btn onClick={act(() => window.spyder.openDashboard())}>Dashboard</Btn>
        <Btn
          variant="ghost"
          className="ml-auto w-8 px-0"
          title={`Switch to ${next}`}
          aria-label={`Switch to ${next}`}
          onClick={act(() => window.spyder.setSettings({ widgetStyle: next }))}
        >
          ⇄
        </Btn>
        <Btn
          variant="ghost"
          className="w-8 px-0"
          title="Hide"
          aria-label="Hide"
          onClick={() => {
            onCollapse();
            void window.spyder.hideWidget();
          }}
        >
          ×
        </Btn>
      </div>
    </div>
  );
}
