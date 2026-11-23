// Dashboard shell (design/DESIGN.md §4): sidebar, footer status, and the page for the route.
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { fmtClock, fmtDuration } from '../../core/format';
import type { WidgetPayload } from '../../preload/api';
import { navigate } from '../router';
import { Btn, inputCls } from '../ui/controls';
import { Month } from './Month';
import { Review } from './Review';
import { Rules } from './Rules';
import { Settings } from './Settings';
import { Today } from './Today';
import { Week } from './Week';
import { applyTagColors, TopBar, useLoader } from './parts';
import { Toast } from './toast';

const icon = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
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
  useEffect(() => {
    void window.spyder.getSettings().then(applyTagColors);
  }, []);
  const go = (p: string, d?: string) => navigate(`dashboard/${p}${d ? `/${d}` : ''}`);
  const onDate = (d: string) => go(page, rv && d === rv.today ? undefined : d);
  return (
    <div className="flex h-full">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-border bg-sidebar px-2.5 pt-3 pb-3">
        <div className="mb-5 flex h-8 items-center gap-2 px-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-accent text-[11px] font-bold text-on-accent">S</div>
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Spyder</span>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} className="mb-4">
            <div className="mb-1 px-2 text-[11px] font-medium text-faint">{g.title}</div>
            {g.items.map((i) => (
              <button
                key={i.id}
                data-nav={i.id}
                // Keep the viewed date when switching between Today and Review.
                onClick={() => go(i.id, i.id === 'today' || i.id === 'review' ? date : undefined)}
                className={clsx(
                  'flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px]',
                  page === i.id ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
                )}
              >
                <span className={page === i.id ? 'text-text' : 'text-faint'}>{ICONS[i.id]}</span>
                {i.label}
                {i.id === 'review' && rv && rv.leftoverCount > 0 && (
                  <span data-testid="review-badge" className="ml-auto rounded-pill bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent tabular">
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
        ) : (page === 'week' || page === 'month') && !(date ?? rv?.today) ? (
          <TopBar title={LABELS[page]} />
        ) : page === 'week' ? (
          <Week date={(date ?? rv?.today)!} onDate={onDate} />
        ) : page === 'month' ? (
          <Month date={(date ?? rv?.today)!} onDate={onDate} />
        ) : page === 'rules' ? (
          <Rules />
        ) : page === 'settings' ? (
          <Settings />
        ) : (
          <TopBar title={LABELS[page] ?? 'Spyder'} />
        )}
      </main>
      <Toast />
    </div>
  );
}

/** Minutes box for the block length (P59): 5–180, applied on Enter or blur, from the next block. */
function LengthBox({ sec }: { sec: number }) {
  const [v, setV] = useState(String(sec / 60));
  const [shown, setShown] = useState(sec);
  if (sec !== shown) {
    setShown(sec);
    setV(String(sec / 60));
  }
  const commit = () => {
    const min = Math.min(180, Math.max(5, Math.round(Number(v) || sec / 60)));
    setV(String(min));
    if (min * 60 !== sec) void window.spyder.setBlockLength(min * 60);
  };
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      <input
        data-testid="block-length"
        aria-label="Block length in minutes"
        type="number"
        min={5}
        max={180}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={clsx(inputCls, 'h-7 w-14 px-1.5 text-center tabular')}
      />
      min blocks
    </label>
  );
}

/** The loop's status like the bar, Start/Stop and the block length (P59); Keep working off hours (P62). */
function Footer() {
  const [w, setW] = useState<WidgetPayload | null>(null);
  const [step, setStep] = useState(30);
  useEffect(() => {
    void window.spyder.getWidget().then(setW);
    void window.spyder.getSettings().then((s) => setStep(s.keepWorkingStepMin));
    return window.spyder.onWidget(setW);
  }, []);
  if (!w) return null;
  const dot = w.running ? 'var(--color-accent)' : w.notStarted ? 'var(--color-orange)' : 'var(--color-faint)';
  const caption = w.running ? `Block · ${fmtDuration(w.blockLengthSec)}` : w.notStarted ? 'Not started' : 'Off hours';
  return (
    <div className="mt-auto flex flex-col gap-1.5 rounded-card border border-border bg-surface p-2.5">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span data-testid="sidebar-status" className={clsx('min-w-0 flex-1 truncate text-[12px]', w.notStarted ? 'text-orange' : 'text-muted')}>
          {caption}
        </span>
        {w.running && (
          <span data-testid="sidebar-timer" className="text-[13px] font-semibold tabular">
            {fmtClock(w.timerSec)}
          </span>
        )}
      </div>
      <LengthBox sec={w.nextLengthSec} />
      {w.running ? (
        <Btn size="sm" data-testid="sidebar-stop" className="w-full" onClick={() => void window.spyder.stop()}>
          Stop
        </Btn>
      ) : (
        <Btn size="sm" variant="primary" data-testid="sidebar-start" className="w-full" onClick={() => void window.spyder.start(w.nextLengthSec)}>
          Start
        </Btn>
      )}
      {w.mode === 'off_hours' && (
        <Btn size="sm" data-testid="keep-working" className="w-full" onClick={() => void window.spyder.keepWorking()}>
          Keep working +{step}
        </Btn>
      )}
      <Btn size="sm" variant="ghost" className="w-full" onClick={() => void window.spyder.showWidget()}>
        Show widget
      </Btn>
    </div>
  );
}
