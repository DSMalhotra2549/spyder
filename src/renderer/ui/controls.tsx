// Shared controls (design/DESIGN.md §2–3).
import clsx from 'clsx';
import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export function Btn({
  variant = 'secondary',
  pill = false,
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pill?: boolean; size?: 'sm' | 'md'; children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'no-drag inline-flex items-center justify-center gap-1.5 border font-medium whitespace-nowrap transition-colors duration-100 disabled:cursor-default disabled:opacity-45',
        pill ? 'h-[34px] rounded-pill px-4 text-[13px]' : size === 'sm' ? 'h-7 rounded-control px-2.5 text-[12px]' : 'h-8 rounded-control px-3 text-[13px]',
        variant === 'primary' && 'border-transparent bg-accent text-on-accent enabled:hover:bg-accent-hover',
        variant === 'secondary' && 'border-border bg-surface text-text enabled:hover:border-border-strong enabled:hover:bg-surface-2',
        variant === 'outline' && 'border-accent/40 bg-accent/10 text-text enabled:hover:bg-accent/15',
        variant === 'ghost' && 'border-transparent bg-transparent text-muted enabled:hover:bg-surface-2 enabled:hover:text-text',
        variant === 'danger' && 'border-transparent bg-transparent text-red enabled:hover:bg-red/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const inputCls =
  'no-drag h-8 rounded-control border border-border bg-surface px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20';

/** A block's free-text answer, with earlier answers as autocomplete (P60). */
export function AnswerInput({
  value,
  onChange,
  onEnter,
  placeholder = 'What did you do?',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const seq = useRef(0);
  const suggest = (v: string) => {
    const n = ++seq.current;
    if (!v.trim()) return setItems([]);
    void window.spyder.answerSuggestions(v).then((r) => {
      if (n === seq.current) setItems(r.filter((x) => x.toLowerCase() !== v.toLowerCase()));
    });
  };
  const show = open && items.length > 0;
  return (
    <div className="relative">
      <input
        className={clsx(inputCls, 'w-full')}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Answer"
        onChange={(e) => {
          onChange(e.target.value);
          suggest(e.target.value);
          setOpen(true);
          setHi(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (show && e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(items.length - 1, h + 1));
          } else if (show && e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(-1, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (show && hi >= 0) {
              onChange(items[hi]);
              setItems([]);
              setOpen(false);
            } else onEnter?.();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {show && (
        <div className="absolute top-[36px] right-0 left-0 z-10 overflow-hidden rounded-control border border-border bg-surface py-1 shadow-pop">
          {items.map((it, i) => (
            <div
              key={it}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(it);
                setItems([]);
                setOpen(false);
              }}
              className={clsx('flex h-[30px] cursor-default items-center px-2.5 text-[13px]', i === hi && 'bg-surface-2')}
            >
              <b>{it.slice(0, value.length)}</b>
              <span className="text-muted">{it.slice(value.length)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
