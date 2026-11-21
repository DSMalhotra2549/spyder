// Dashboard building blocks (design/DESIGN.md §4).
import clsx from 'clsx';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActivityCategory } from '../../core/categorize';
import type { Category } from '../../core/defaults';
import { addDays, dateKey, dayStartFromKey } from '../../core/schedule';

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
}: {
  title: string;
  date?: string;
  today?: string;
  onDate?: (d: string) => void;
  actions?: ReactNode;
}) {
  const step = (n: number) => date && onDate?.(dateKey(addDays(dayStartFromKey(date), n)));
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      {date && (
        <div className="flex items-center gap-1.5">
          <NavBtn label="Previous day" onClick={() => step(-1)}>
            ‹
          </NavBtn>
          <NavBtn label="Next day" onClick={() => step(1)} disabled={!!today && date >= today}>
            ›
          </NavBtn>
          <span data-testid="date-label" className="ml-1.5 text-[13px] text-muted tabular">
            {format(dayStartFromKey(date), 'EEE, MMM d yyyy')}
          </span>
          {today && date !== today && (
            <button className="ml-2 text-[12px] text-accent hover:underline" onClick={() => onDate?.(today)}>
              Back to today
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
      className="flex h-8 w-8 items-center justify-center rounded-control bg-surface-2 text-[16px] text-muted hover:text-text disabled:text-faint"
    >
      {children}
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
          <span className="section-label">{title}</span>
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
        'flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface p-5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="section-label mb-2 truncate">{label}</div>
        <div
          data-testid={testId}
          className={clsx(
            'text-[28px] leading-[1.1] font-semibold whitespace-nowrap tabular',
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

/** 44 px progress ring (productive / goal), green once met. */
export function GoalRing({ frac }: { frac: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <svg width={44} height={44} className="shrink-0 -rotate-90">
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={4} />
      {f > 0 && (
        <circle
          cx={22}
          cy={22}
          r={r}
          fill="none"
          stroke={f >= 1 ? 'var(--color-green)' : 'var(--color-accent)'}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${f * c} ${c}`}
        />
      )}
    </svg>
  );
}

/** Category pill; click opens a menu that creates a user rule (P12). */
export function CategoryChip({
  category,
  onPick,
}: {
  category: ActivityCategory;
  onPick?: (c: Category) => void;
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
        className="flex h-[22px] items-center gap-1.5 rounded-pill border border-border bg-surface-2 pr-2 pl-2 text-[11px] font-semibold text-text hover:border-border-strong disabled:hover:border-border"
      >
        <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[category] }} />
        {CAT_LABEL[category]}
        {onPick && <span className="text-muted">▾</span>}
      </button>
      {open && onPick && (
        <div className="absolute top-[26px] right-0 z-20 w-[150px] rounded-control border border-border-strong bg-surface-2 p-1 shadow-float">
          {(['productive', 'neutral', 'distracting'] as const).map((c) => (
            <button
              key={c}
              data-category={c}
              onClick={() => {
                setOpen(false);
                if (c !== category) onPick(c);
              }}
              className={clsx(
                'flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left text-[12px] hover:bg-surface',
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
