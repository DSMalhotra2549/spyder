// Today page (plan §12, design/DESIGN.md §4 Today) — a single calm column (P45).
import clsx from 'clsx';
import { useState } from 'react';
import type { AppRow } from '../../core/aggregate';
import type { ActivityCategory } from '../../core/categorize';
import { fmtDuration, fmtHM, fmtTime } from '../../core/format';
import type { DayVM } from '../../core/review';
import { Timeline } from './Timeline';
import { ExportButton } from './Export';
import { CAT_COLOR, CAT_LABEL, CategoryChip, Empty, TopBar, useLoader } from './parts';
import { appTexts, statTexts } from './stats';

const KIND_LABEL = { planned: 'Planned', timed: 'Timed', open: 'Open', break: 'Break' };

export function Today({ date, onDate }: { date?: string; onDate: (d: string) => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getDay(date), date ?? '', true);
  if (!vm) return <TopBar title="Today" />;
  return (
    <>
      <TopBar title="Today" date={vm.date} today={vm.today} onDate={onDate} actions={<ExportButton />} />
      <TodayBody vm={vm} reload={reload} />
    </>
  );
}

function TodayBody({ vm, reload }: { vm: DayVM; reload: () => Promise<void> }) {
  const s = vm.summary;
  const t = statTexts(s, vm.streak);
  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto px-6 py-10" data-testid="today">
      <div className="mx-auto flex max-w-[760px] flex-col gap-10">
        <Hero vm={vm} t={t} />

        <section data-testid="timeline-card">
          <h2 className="section-label mb-3">Timeline</h2>
          <Timeline s={s} nowMs={vm.date === vm.today ? vm.nowMs : -1} />
        </section>

        <section>
          <h2 className="mb-3 flex items-baseline">
            <span className="section-label">Where your time went</span>
            <span className="ml-auto text-[12px] text-faint">{s.scope === 'work_hours' ? 'work hours' : 'all day'}</span>
          </h2>
          <CategoryBar totals={s.categoryTotals} />
          <TopApps rows={s.apps} reload={reload} />
        </section>

        <Sessions vm={vm} />

        {s.offHoursActivitySec > 0 && (
          <p data-testid="off-hours-note" className="-mt-4 text-[12px] text-faint">
            {fmtDuration(s.offHoursActivitySec)} of activity outside work hours
            {s.scope === 'work_hours' ? ' (not in the percentages)' : ''}.
          </p>
        )}
      </div>
    </div>
  );
}

/** One big number (productive vs goal); everything else is a quiet line under it. */
function Hero({ vm, t }: { vm: DayVM; t: ReturnType<typeof statTexts> }) {
  const s = vm.summary;
  const frac = s.goalSec > 0 ? Math.min(1, s.productiveSec / s.goalSec) : 0;
  const dot = <span className="px-2 text-faint">·</span>;
  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span
          data-testid="stat-productive"
          className={clsx('text-[48px] leading-none font-semibold tabular', s.goalMet && 'text-green')}
        >
          {t.productive}
        </span>
        <span className="text-[18px] text-muted">productive</span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-2">
          <div
            className={clsx('h-full rounded-pill', s.goalMet ? 'bg-green' : 'bg-accent')}
            style={{ width: `${frac * 100}%` }}
          />
        </div>
        <span data-testid="stat-productive-sub" className="text-[13px] text-muted tabular">
          {t.productiveSub}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-muted tabular">
        <span data-testid="stat-work" className="text-text">
          {t.work}
        </span>{' '}
        worked{dot}
        <span data-testid="stat-work-sub">{t.workSub}</span>
        {dot}
        <span data-testid="stat-score" className="text-text">
          {t.score}
        </span>{' '}
        day score (<span data-testid="stat-score-sub">{t.scoreSub}</span>)
        {dot}
        <span data-testid="stat-streak" className="text-text">
          {t.streak}
        </span>{' '}
        streak
      </p>
      {(s.flags.length > 0 || s.distractingSec > 0) && (
        <div className="mt-5 rounded-control bg-[color-mix(in_srgb,var(--color-red)_10%,transparent)] px-3 py-2 text-[13px]">
          <div className="flex items-center gap-2 text-red">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red" />
            <span>
              <span data-testid="stat-distractions">{t.distractions}</span>{' '}
              {s.flags.length === 1 ? 'distraction flag' : 'distraction flags'} ·{' '}
              <span data-testid="stat-distractions-sub">{t.distractionsSub}</span>
            </span>
          </div>
          {s.flags.length > 0 && (
            <ul className="mt-1 pl-4 text-muted">
              {s.flags.map((f, i) => (
                <li key={i} data-testid="flag-row" className="tabular">
                  {f.target} at {fmtTime(f.tsMs)} — {fmtDuration(f.continuousSec)} straight
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** One thin stacked bar with an inline legend (replaces the donut). */
function CategoryBar({ totals }: { totals: Record<ActivityCategory, number> }) {
  const data = (Object.keys(totals) as ActivityCategory[]).map((k) => ({ k, v: totals[k] })).filter((d) => d.v > 0);
  const total = data.reduce((n, d) => n + d.v, 0);
  if (!total) return <Empty>No activity recorded</Empty>;
  return (
    <div className="mb-4">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-pill">
        {data.map((d) => (
          <div key={d.k} style={{ width: `${(d.v / total) * 100}%`, background: CAT_COLOR[d.k] }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {data.map((d) => (
          <li key={d.k} data-testid={`cat-${d.k}`} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[d.k] }} />
            {CAT_LABEL[d.k]}
            <span className="text-text tabular">{fmtHM(d.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOP_N = 5;

/** Top apps & sites, the rest behind "Show all". Category is a quiet, clickable label (P12). */
function TopApps({ rows, reload }: { rows: AppRow[]; reload: () => Promise<void> }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, TOP_N);
  return (
    <>
      <ol>
        {shown.map((a) => {
          const t = appTexts(a);
          const target = a.ruleTarget;
          return (
            <li
              key={a.key}
              data-testid="app-row"
              className="flex h-10 items-center gap-3 border-b border-border text-[14px] last:border-0"
            >
              <span data-k="key" className="min-w-0 flex-1 truncate">
                {t.key}
              </span>
              <span data-k="time" className="w-12 text-right tabular">
                {t.time}
              </span>
              <span data-k="pct" className="w-12 text-right text-[12px] text-faint tabular">
                {t.pct}
              </span>
              <div className="flex w-[120px] justify-end">
                <CategoryChip
                  quiet
                  category={a.category}
                  onPick={
                    target
                      ? async (c) => {
                          await window.spyder.saveRule({ ...target, category: c });
                          await reload();
                        }
                      : undefined
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > TOP_N && (
        <button
          data-testid="apps-show-all"
          onClick={() => setAll((v) => !v)}
          className="mt-2 text-[12px] text-muted hover:text-text"
        >
          {all ? 'Show less' : `Show all ${rows.length} →`}
        </button>
      )}
    </>
  );
}

/** Collapsed by default: one line that opens the session list. */
function Sessions({ vm }: { vm: DayVM }) {
  const [open, setOpen] = useState(false);
  const rows = vm.summary.sessions;
  if (!rows.length) return null;
  return (
    <section>
      <button
        data-testid="sessions-toggle"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[13px] text-muted hover:text-text"
      >
        <span className={clsx('inline-block w-3', open && 'rotate-90')}>▸</span>
        {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
      </button>
      {open && (
        <ul className="mt-3">
          {rows.map((r) => {
            const over = r.deltaSec !== null && !!r.plannedSec && r.deltaSec > r.plannedSec * 0.1;
            return (
              <li
                key={r.id}
                data-testid="session-row"
                className="flex h-9 items-center gap-3 border-b border-border text-[13px] last:border-0"
              >
                <span className="w-24 shrink-0 text-muted tabular">
                  {fmtTime(r.startMs)}–{r.running ? 'now' : r.endMs !== null ? fmtTime(r.endMs) : ''}
                </span>
                {r.projectColor && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.projectColor }} />
                )}
                <span className={clsx('min-w-0 flex-1 truncate', !r.name && 'text-muted')}>
                  {r.name ?? (r.kind === 'break' ? 'Break' : 'Unlabelled')}
                </span>
                <span className="tabular">{fmtHM(r.elapsedSec)}</span>
                <span className={clsx('w-28 text-right text-[12px] tabular', over ? 'text-red' : 'text-faint')}>
                  {r.plannedSec !== null ? `of ${fmtHM(r.plannedSec)} planned` : KIND_LABEL[r.kind].toLowerCase()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Ranked apps & sites with a category chip per row (Week's top 10). */
export function AppsList({ rows, reload, compact }: { rows: AppRow[]; reload: () => Promise<void>; compact?: boolean }) {
  if (!rows.length) return <Empty>No activity recorded</Empty>;
  return (
    <ol>
      {rows.map((a, i) => {
        const t = appTexts(a);
        const target = a.ruleTarget;
        return (
          <li key={a.key} data-testid="app-row" className="relative flex h-9 items-center gap-3 border-b border-border px-2 text-[13px] last:border-0">
            <div
              className="absolute inset-y-1 left-0 rounded-bar"
              style={{ width: `${a.pct}%`, background: CAT_COLOR[a.category], opacity: 0.15 }}
            />
            <span className="relative w-5 text-muted tabular">{i + 1}</span>
            <span data-k="key" className="relative min-w-0 flex-1 truncate">
              {t.key}
            </span>
            <span data-k="time" className={clsx('relative text-right tabular', compact ? 'w-11' : 'w-14')}>
              {t.time}
            </span>
            <span data-k="pct" className={clsx('relative text-right text-muted tabular', compact ? 'w-12' : 'w-14')}>
              {t.pct}
            </span>
            {!compact && (
            <div className="relative w-[124px] flex justify-end">
              <CategoryChip
                category={a.category}
                onPick={
                  target
                    ? async (c) => {
                        await window.spyder.saveRule({ ...target, category: c });
                        await reload();
                      }
                    : undefined
                }
              />
            </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
