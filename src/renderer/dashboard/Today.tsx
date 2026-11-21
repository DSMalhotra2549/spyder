// Today page (plan §12, design/DESIGN.md §4 Today).
import clsx from 'clsx';
import { Pie, PieChart } from 'recharts';
import type { AppRow } from '../../core/aggregate';
import type { ActivityCategory } from '../../core/categorize';
import { fmtDuration, fmtHM, fmtTime } from '../../core/format';
import type { DayVM } from '../../core/review';
import { Timeline } from './Timeline';
import { CAT_COLOR, CAT_LABEL, Card, CategoryChip, Empty, GoalRing, Stat, TopBar, useLoader } from './parts';
import { appTexts, statTexts } from './stats';

const KIND_LABEL = { planned: 'Planned', timed: 'Timed', open: 'Open', break: 'Break' };

export function Today({ date, onDate }: { date?: string; onDate: (d: string) => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getDay(date), date ?? '', true);
  if (!vm) return <TopBar title="Today" />;
  return (
    <>
      <TopBar title="Today" date={vm.date} today={vm.today} onDate={onDate} />
      <TodayBody vm={vm} reload={reload} />
    </>
  );
}

function TodayBody({ vm, reload }: { vm: DayVM; reload: () => Promise<void> }) {
  const s = vm.summary;
  const t = statTexts(s, vm.streak);
  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto p-6" data-testid="today">
      <div className="grid grid-cols-12 gap-4">
        <Stat label="Work time" value={t.work} sub={t.workSub} testId="stat-work" className="col-span-2" />
        <Stat
          label="Productive"
          value={t.productive}
          sub={t.productiveSub}
          testId="stat-productive"
          className="col-span-3"
          tone={s.goalMet ? 'green' : undefined}
          aside={<GoalRing frac={s.goalSec > 0 ? s.productiveSec / s.goalSec : 0} />}
        />
        <Stat label="Day score" value={t.score} sub={t.scoreSub} testId="stat-score" className="col-span-3" />
        <Stat label="Streak" value={t.streak} sub="goal met in a row" testId="stat-streak" className="col-span-2" />
        <Stat
          label="Distractions"
          value={t.distractions}
          sub={t.distractionsSub}
          testId="stat-distractions"
          className="col-span-2"
          tone={s.flags.length > 0 || s.distractingSec > 0 ? 'red' : undefined}
        />
      </div>

      <Card title="Timeline" className="mt-4" testId="timeline-card">
        <Timeline s={s} nowMs={vm.date === vm.today ? vm.nowMs : -1} />
      </Card>

      <div className="mt-4 grid grid-cols-12 gap-4">
        <Card title="Sessions" right={`${s.sessions.length}`} className="col-span-7">
          <SessionsTable vm={vm} />
        </Card>
        <Card title="Categories" right={s.scope === 'work_hours' ? 'work hours' : 'all day'} className="col-span-5">
          <Donut totals={s.categoryTotals} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-12 gap-4">
        <Card title="Apps & sites" right={s.scope === 'work_hours' ? 'work hours' : 'all day'} className="col-span-7">
          <AppsList rows={s.apps} reload={reload} />
        </Card>
        <Card title="Distraction flags" right={`${s.flags.length}`} className="col-span-5">
          {s.flags.length === 0 ? (
            <Empty>No distraction flags</Empty>
          ) : (
            <ul>
              {s.flags.map((f, i) => (
                <li key={i} data-testid="flag-row" className="flex h-9 items-center gap-3 border-b border-border text-[13px] last:border-0">
                  <span className="h-2 w-2 rounded-full bg-red" />
                  <span className="w-12 text-muted tabular">{fmtTime(f.tsMs)}</span>
                  <span className="truncate">{f.target}</span>
                  <span className="ml-auto text-muted tabular">{fmtDuration(f.continuousSec)} straight</span>
                </li>
              ))}
            </ul>
          )}
          {s.offHoursActivitySec > 0 && (
            <p data-testid="off-hours-note" className="mt-3 text-[12px] text-muted">
              {fmtDuration(s.offHoursActivitySec)} of activity outside work hours
              {s.scope === 'work_hours' ? ' (not in the percentages)' : ''}.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

const th = 'section-label h-8 bg-surface-2 px-2 text-left font-semibold';
const td = 'h-9 border-b border-border px-2';

function SessionsTable({ vm }: { vm: DayVM }) {
  const rows = vm.summary.sessions;
  if (!rows.length) return <Empty>No sessions</Empty>;
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={th}>Session</th>
          <th className={th}>Kind</th>
          <th className={th}>Time</th>
          <th className={clsx(th, 'text-right')}>Actual</th>
          <th className={clsx(th, 'text-right')}>Planned</th>
          <th className={clsx(th, 'text-right')}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid="session-row" className="hover:bg-surface-2">
            <td className={clsx(td, 'max-w-[220px]')}>
              <div className="flex items-center gap-2">
                {r.projectColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.projectColor }} />}
                <span className={clsx('truncate', !r.name && 'text-muted')}>
                  {r.name ?? (r.kind === 'break' ? 'Break' : 'Unlabelled')}
                </span>
              </div>
            </td>
            <td className={clsx(td, 'text-muted')}>{KIND_LABEL[r.kind]}</td>
            <td className={clsx(td, 'text-muted tabular')}>
              {fmtTime(r.startMs)}–{r.running ? 'now' : r.endMs !== null ? fmtTime(r.endMs) : ''}
            </td>
            <td className={clsx(td, 'text-right tabular')}>{fmtHM(r.elapsedSec)}</td>
            <td className={clsx(td, 'text-right text-muted tabular')}>{r.plannedSec !== null ? fmtHM(r.plannedSec) : '—'}</td>
            <td
              className={clsx(
                td,
                'text-right tabular',
                r.deltaSec !== null && r.plannedSec && r.deltaSec > r.plannedSec * 0.1 ? 'text-red' : 'text-muted',
              )}
            >
              {r.deltaSec === null ? '—' : `${r.deltaSec >= 0 ? '+' : '−'}${fmtHM(Math.abs(r.deltaSec))}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ranked apps & sites with a category chip per row (also used by Week's top 10). */
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

function Donut({ totals }: { totals: Record<ActivityCategory, number> }) {
  const data = (Object.keys(totals) as ActivityCategory[]).map((k) => ({ k, v: totals[k], fill: CAT_COLOR[k] })).filter((d) => d.v > 0);
  const total = data.reduce((t, d) => t + d.v, 0);
  if (!total) return <Empty>No activity recorded</Empty>;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-[160px] w-[160px] shrink-0">
        <PieChart width={160} height={160}>
          <Pie data={data} dataKey="v" nameKey="k" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke="none" isAnimationActive={false} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[20px] font-semibold tabular">{fmtHM(total)}</div>
          <div className="section-label">tracked</div>
        </div>
      </div>
      <ul className="w-full text-[12px]">
        {data.map((d) => (
          <li key={d.k} data-testid={`cat-${d.k}`} className="flex h-8 items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[d.k] }} />
            <span className="truncate">{CAT_LABEL[d.k]}</span>
            <span className="ml-auto tabular">{fmtHM(d.v)}</span>
            <span className="w-10 text-right text-muted tabular">{Math.round((d.v / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
