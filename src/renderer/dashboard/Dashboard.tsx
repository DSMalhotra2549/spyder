// Dashboard shell (design/DESIGN.md §4): sidebar, footer status, and the page for the route.
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { fmtClock } from '../../core/format';
import type { WidgetPayload } from '../../preload/api';
import { navigate } from '../router';
import { Btn } from '../ui/controls';
import { Review } from './Review';
import { Today } from './Today';
import { TopBar, useLoader } from './parts';

const icon = (d: string) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS: Record<string, ReactNode> = {
  today: icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2'),
  review: icon('M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9'),
  week: icon('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  month: icon('M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14H3zM3 10h18M8 2v4M16 2v4'),
  rules: icon('M4 6h16M4 12h10M4 18h6'),
  settings: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
};

const GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  { title: 'Today', items: [{ id: 'today', label: 'Today' }, { id: 'review', label: 'Review' }] },
  { title: 'Trends', items: [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }] },
  { title: 'Setup', items: [{ id: 'rules', label: 'Rules' }, { id: 'settings', label: 'Settings' }] },
];
const LABELS: Record<string, string> = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

export function Dashboard({ page, date }: { page: string; date?: string }) {
  // Pending review items for the sidebar badge (today).
  const [rv, reloadBadge] = useLoader(() => window.spyder.getReview(), page, true);
  const go = (p: string, d?: string) => navigate(`dashboard/${p}${d ? `/${d}` : ''}`);
  const onDate = (d: string) => go(page, rv && d === rv.today ? undefined : d);
  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">S</div>
          <span className="text-[15px] font-semibold">Spyder</span>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} className="mb-5">
            <div className="section-label mb-1 px-2">{g.title}</div>
            {g.items.map((i) => (
              <button
                key={i.id}
                data-nav={i.id}
                // Keep the viewed date when switching between Today and Review.
                onClick={() => go(i.id, i.id === 'today' || i.id === 'review' ? date : undefined)}
                className={clsx(
                  'flex h-[34px] w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px]',
                  page === i.id ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                )}
              >
                {ICONS[i.id]}
                {i.label}
                {i.id === 'review' && rv && rv.leftoverCount > 0 && (
                  <span data-testid="review-badge" className="ml-auto rounded-pill bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular">
                    {rv.leftoverCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        ))}
        <Footer />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {page === 'today' ? (
          <Today date={date} onDate={onDate} />
        ) : page === 'review' ? (
          <Review date={date} onDate={onDate} onChanged={() => void reloadBadge()} />
        ) : (
          <>
            <TopBar title={LABELS[page] ?? 'Spyder'} />
            <section className="p-6">
              <div className="rounded-card border border-border bg-surface p-4 text-muted">Nothing here yet.</div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const KIND_DOT: Record<string, string> = {
  planned: 'var(--color-planned)',
  timed: 'var(--color-timed)',
  open: 'var(--color-open)',
  break: 'var(--color-break)',
};

/** Mini status like the widget: state dot, timer and a two-line caption. */
function Footer() {
  const [w, setW] = useState<WidgetPayload | null>(null);
  useEffect(() => {
    void window.spyder.getWidget().then(setW);
    return window.spyder.onWidget(setW);
  }, []);
  if (!w) return null;
  const dot = w.mode === 'away' ? 'var(--color-away)' : w.mode === 'off_hours' || !w.kind ? 'var(--color-faint)' : KIND_DOT[w.kind];
  const caption = w.mode === 'off_hours' ? 'Off hours' : w.mode === 'away' ? 'Away' : w.title;
  return (
    <div className="mt-auto border-t border-border px-2 pt-3">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
        {w.mode === 'working' && (
          <span className={clsx('text-[15px] font-bold tabular', w.isOvertime && 'text-red')}>
            {w.isOvertime ? '+' : ''}
            {fmtClock(w.timerSec)}
          </span>
        )}
        <span className="caps line-clamp-2 min-w-0 text-muted">{caption}</span>
      </div>
      <Btn variant="ghost" className="w-full" onClick={() => void window.spyder.showWidget()}>
        Show widget
      </Btn>
    </div>
  );
}
