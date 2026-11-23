// Dashboard building blocks (design/DESIGN.md §4).
import clsx from 'clsx';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActivityCategory } from '../../core/categorize';
import type { Category } from '../../core/defaults';
import { addDays, dateKey, dayStartFromKey } from '../../core/schedule';
import { addMonths, weekDates } from '../../core/trends';

export type Period = 'day' | 'week' | 'month';

const stepDate = (date: string, unit: Period, n: number) =>
  unit === 'month' ? addMonths(date, n) : dateKey(addDays(dayStartFromKey(date), unit === 'week' ? 7 * n : n));

function periodLabel(date: string, unit: Period): string {
  const d = dayStartFromKey(date);
  if (unit === 'month') return format(d, 'MMMM yyyy');
  if (unit === 'week') {
    const w = weekDates(date);
    return `${format(dayStartFromKey(w[0]), 'MMM d')} – ${format(dayStartFromKey(w[6]), 'MMM d yyyy')}`;
  }
  return format(d, 'EEE, MMM d yyyy');
}

/** First day of the period containing `date` (for "is the next period in the future?"). */
const periodStart = (date: string, unit: Period) =>
  unit === 'month' ? `${date.slice(0, 7)}-01` : unit === 'week' ? weekDates(date)[0] : date;

export const CAT_COLOR: Record<ActivityCategory, string> = {
  productive: 'var(--color-productive)',
  neutral: 'var(--color-neutral)',
  distracting: 'var(--color-distracting)',
  uncategorized: 'var(--color-uncategorized)',
};
export const CAT_LABEL: Record<ActivityCategory, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  distracting: 'Distracting',
  uncategorized: 'Uncategorized',
};

/**
 * Loads data, reloads when `key` changes, every 15 s while `live`, and when the window regains
 * focus. Returns the latest value and a manual reload.
 */
/** P67: the user's work colour, used by every work block in the dashboard. */
export function applyWorkColor(color: string): void {
  document.documentElement.style.setProperty('--color-work', color);
}

export function useLoader<T>(
  fn: () => Promise<T>,
  key: string,
  live = false,
): [T | null, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const reload = useCallback(async () => {
    const n = ++seq.current;
    const v = await fnRef.current();
    if (n === seq.current) setData(v);
  }, []);
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    const t = live ? setInterval(() => void reload(), 15_000) : undefined;
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [reload, key, live]);
  return [data, reload];
}

export function TopBar({
  title,
  date,
  today,
  onDate,
  actions,
  unit = 'day',
}: {
  title: string;
  date?: string;
  today?: string;
  onDate?: (d: string) => void;
  actions?: ReactNode;
  unit?: Period;
}) {
  const step = (n: number) => date && onDate?.(stepDate(date, unit, n));
  const nextStart = date ? periodStart(stepDate(date, unit, 1), unit) : '';
  const isCurrent = !!today && !!date && periodStart(date, unit) === periodStart(today, unit);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-6">
      <h1 className="text-[14px] font-semibold">{title}</h1>
      {date && (
        <div className="flex items-center gap-1">
          <NavBtn label={`Previous ${unit}`} onClick={() => step(-1)}>
            ‹
          </NavBtn>
          <NavBtn label={`Next ${unit}`} onClick={() => step(1)} disabled={!!today && nextStart > today}>
            ›
          </NavBtn>
          <span data-testid="date-label" className="ml-1 text-[13px] text-muted tabular">
            {periodLabel(date, unit)}
          </span>
          {today && !isCurrent && (
            <button className="ml-2 rounded-control px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10" onClick={() => onDate?.(today)}>
              {unit === 'day' ? 'Back to today' : `This ${unit}`}
            </button>
          )}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}

function NavBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text disabled:text-faint disabled:hover:bg-transparent"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={children === '‹' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
      </svg>
    </button>
  );
}

export function Card({
  title,
  right,
  className,
  children,
  testId,
}: {
  title?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={clsx('min-w-0 rounded-card border border-border bg-surface p-4', className)}
    >
      {title && (
        <div className="mb-3 flex items-center">
          <span className="section-title">{title}</span>
          {right && <span className="ml-auto text-[12px] text-muted tabular">{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  testId,
  tone,
  aside,
  className,
}: {
  className?: string;
  label: string;
  value: string;
  sub?: string;
  testId: string;
  tone?: 'red' | 'green';
  aside?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="section-label mb-1 truncate">{label}</div>
        <div
          data-testid={testId}
          className={clsx(
            'text-[20px] leading-[1.2] font-semibold whitespace-nowrap tabular',
            tone === 'red' && 'text-red',
            tone === 'green' && 'text-green',
          )}
        >
          {value}
        </div>
        {sub && (
          <div data-testid={`${testId}-sub`} className="mt-1 truncate text-[12px] text-muted tabular">
            {sub}
          </div>
        )}
      </div>
      {aside}
    </div>
  );
}

/** Category pill; click opens a menu that creates a user rule (P12). */
export function CategoryChip({
  category,
  onPick,
  quiet,
}: {
  category: ActivityCategory;
  onPick?: (c: Category) => void;
  /** No pill outline; muted label, ▾ only on hover (Today page). */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        data-testid="category-chip"
        disabled={!onPick}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'group/chip flex h-[22px] items-center gap-1.5 rounded-control pr-1.5 pl-2 text-[12px]',
          quiet
            ? 'text-muted hover:bg-surface-2 hover:text-text'
            : 'border border-border text-text hover:bg-surface-2 disabled:hover:bg-transparent',
        )}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[category] }} />
        {CAT_LABEL[category]}
        {onPick && <span className={clsx('text-muted', quiet && 'invisible group-hover/chip:visible')}>▾</span>}
      </button>
      {open && onPick && (
        <div className="absolute top-[26px] right-0 z-20 w-[150px] rounded-card border border-border bg-surface p-1 shadow-pop">
          {(['productive', 'neutral', 'distracting'] as const).map((c) => (
            <button
              key={c}
              data-category={c}
              onClick={() => {
                setOpen(false);
                if (c !== category) onPick(c);
              }}
              className={clsx(
                'flex h-7 w-full items-center gap-2 rounded-chip px-2 text-left text-[12px] hover:bg-surface-2',
                c === category && 'text-muted',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />
              {CAT_LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="py-6 text-center text-[12px] text-faint">{children}</div>
);

/** 32 × 18 switch (design/DESIGN.md §4 Settings). */
export function Toggle({
  on,
  onChange,
  label,
  testId,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-[18px] w-8 shrink-0 rounded-pill transition-colors',
        on ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all',
          on ? 'left-[16px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="inline-flex rounded-control bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-6 rounded-chip px-2.5 text-[12px] font-medium',
            o.value === value ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-border' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const DefaultChip = () => (
  <span className="rounded-chip bg-surface-2 px-1.5 text-[11px] leading-[18px] text-muted">
    default
  </span>
);
