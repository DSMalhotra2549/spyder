// Week page (plan §12, design/DESIGN.md §4 Week).
import clsx from 'clsx';
import { format } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtHM } from '../../core/format';
import { dayStartFromKey } from '../../core/schedule';
import {
  estimates,
  STACK_KEYS,
  stackTotal,
  topApps,
  weekDates,
  type DayLite,
  type DayStacks,
  type RangeVM,
} from '../../core/trends';
import { AppsList } from './Today';
import { EfficiencyTrend } from './Month';
import { CAT_COLOR, Card, Empty, Stat, TopBar, useLoader } from './parts';
import { pct, rangeTexts } from './stats';

export const STACK_COLOR: Record<keyof DayStacks, string> = {
  ...CAT_COLOR,
  break: 'var(--color-break)',
  away: 'var(--color-away)',
};
export const STACK_LABEL: Record<keyof DayStacks, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  uncategorized: 'Uncategorized',
  distracting: 'Distracting',
  break: 'Break',
  away: 'Away',
};

export function RangeStats({ vm }: { vm: RangeVM }) {
  const t = rangeTexts(vm.days);
  return (
    <div className="grid grid-cols-5 gap-4">
      <Stat label="Total work" value={t.work} sub={t.workSub} testId="range-work" />
      <Stat label="Productive" value={t.productive} sub={t.productiveSub} testId="range-productive" />
      <Stat label="Avg day score" value={t.score} sub="scheduled days" testId="range-score" />
      <Stat label="Efficiency" value={t.efficiency} sub={t.efficiencySub} testId="range-efficiency" />
      <Stat label="Goals hit" value={t.goals} sub={`streak ${vm.streak} ${vm.streak === 1 ? 'day' : 'days'}`} testId="range-goals" />
    </div>
  );
}

export function Week({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const w = weekDates(date);
  const [vm, reload] = useLoader(() => window.spyder.getRange(w[0], w[6]), w[0]);
  if (!vm) return <TopBar title="Week" />;
  const top = topApps(vm.days, 10);
  return (
    <>
      <TopBar title="Week" date={date} today={vm.today} onDate={onDate} unit="week" />
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-6" data-testid="week">
        <RangeStats vm={vm} />
        <div className="mt-4 grid grid-cols-12 gap-4">
          <Card title="Time by day" className="col-span-7">
            <WeekBars days={vm.days} />
            <Legend />
          </Card>
          <Card title="Top sites & apps" right="work hours" className="col-span-5">
            <AppsList rows={top} reload={reload} compact />
          </Card>
        </div>
        <Card title="Efficiency" className="mt-4" right="by day">
          <EfficiencyTrend days={vm.days} />
        </Card>
        <Card title="Estimate accuracy" className="mt-4" right="planned sessions">
          <Estimates days={vm.days} />
        </Card>
      </div>
    </>
  );
}

function Legend() {
  return (
    <span className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {STACK_KEYS.map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: STACK_COLOR[k] }} />
          {STACK_LABEL[k]}
        </span>
      ))}
    </span>
  );
}

const H = 3600;

function WeekBars({ days }: { days: DayLite[] }) {
  const data = days.map((d) => ({
    date: d.date,
    label: format(dayStartFromKey(d.date), 'EEE d'),
    ...Object.fromEntries(STACK_KEYS.map((k) => [k, d.stacks[k] / H])),
    cap: 0,
  }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  return (
    <div data-testid="week-bars" className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 28, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
          />
          <YAxis
            width={36}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            tickFormatter={(v: number) => `${v}h`}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-2)', opacity: 0.5 }}
            content={<BarTip byDate={byDate} />}
          />
          {STACK_KEYS.map((k) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={STACK_COLOR[k]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
          {/* An empty top stack whose label shows the day total and the goal marker above the bar. */}
          <Bar dataKey="cap" stackId="a" shape={EmptyShape} maxBarSize={28} isAnimationActive={false}>
            <LabelList dataKey="date" content={(p) => <TopLabel {...(p as LabelProps)} byDate={byDate} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A custom shape keeps zero-height rects, so the label above still renders. */
const EmptyShape = () => <g />;

interface LabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: string | number;
}

function TopLabel({ x, y, width, value, byDate }: LabelProps & { byDate: Map<string, DayLite> }) {
  const d = byDate.get(String(value));
  if (!d || d.future) return null;
  const total = stackTotal(d.stacks);
  const cx = Number(x) + Number(width) / 2;
  const top = Number(y);
  return (
    <g data-testid="week-total" data-date={d.date}>
      {total > 0 && (
        <text
          x={cx}
          y={top - 8}
          textAnchor="middle"
          fontSize={11}
          fill="var(--color-muted)"
          className="tabular"
        >
          {fmtHM(total)}
        </text>
      )}
      {d.goalMet && d.scheduled && (
        <g data-testid="goal-hit">
          <circle cx={cx} cy={top - 22} r={5} fill="var(--color-green)" />
          <path
            d={`M${cx - 2.5} ${top - 22}l1.8 1.8 3.2-3.4`}
            stroke="var(--color-bg)"
            strokeWidth={1.4}
            fill="none"
          />
        </g>
      )}
    </g>
  );
}

function BarTip({
  active,
  label,
  byDate,
  payload,
}: {
  active?: boolean;
  label?: string;
  byDate: Map<string, DayLite>;
  payload?: { payload?: { date?: string } }[];
}) {
  const d = byDate.get(payload?.[0]?.payload?.date ?? '');
  if (!active || !d) return null;
  return (
    <div className="rounded-chip border border-border-strong bg-surface-2 px-3 py-2 text-[12px]">
      <div className="mb-1 font-semibold">{label}</div>
      {STACK_KEYS.filter((k) => d.stacks[k] > 0).map((k) => (
        <div key={k} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: STACK_COLOR[k] }} />
          <span className="text-muted">{STACK_LABEL[k]}</span>
          <span className="ml-auto pl-4 tabular">{fmtHM(d.stacks[k])}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-1 text-muted">
        Productive {fmtHM(d.productiveSec)} · score {pct(d.score)}
        {d.goalMet && d.scheduled ? ' · goal met' : ''}
      </div>
    </div>
  );
}

const th = 'section-label h-8 bg-surface-2 px-2 text-left font-semibold';
const td = 'h-9 border-b border-border px-2';

function Estimates({ days }: { days: DayLite[] }) {
  const e = estimates(days);
  if (!e.rows.length) return <Empty>No planned sessions this week</Empty>;
  const over = (r: { deltaSec: number; plannedSec: number }) => r.deltaSec > r.plannedSec * 0.1;
  const within = e.rows.filter((r) => Math.abs(r.deltaSec) <= r.plannedSec * 0.1).length;
  const delta = e.actualSec - e.plannedSec;
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={th}>Session</th>
          <th className={th}>Day</th>
          <th className={clsx(th, 'text-right')}>Planned</th>
          <th className={clsx(th, 'text-right')}>Actual</th>
          <th className={clsx(th, 'text-right')}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {e.rows.map((r) => (
          <tr key={r.id} data-testid="estimate-row" className="hover:bg-surface-2">
            <td className={clsx(td, 'max-w-[320px] truncate', !r.name && 'text-muted')}>
              {r.name ?? 'Unlabelled'}
            </td>
            <td className={clsx(td, 'text-muted tabular')}>{format(r.startMs, 'EEE d, HH:mm')}</td>
            <td className={clsx(td, 'text-right text-muted tabular')}>{fmtHM(r.plannedSec)}</td>
            <td className={clsx(td, 'text-right tabular')}>{fmtHM(r.actualSec)}</td>
            <td className={clsx(td, 'text-right tabular', over(r) ? 'text-red' : 'text-muted')}>
              {r.deltaSec >= 0 ? '+' : '−'}
              {fmtHM(Math.abs(r.deltaSec))}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className="h-9 px-2 text-muted" colSpan={2}>
            {within} of {e.rows.length} within 10 %
          </td>
          <td className="h-9 px-2 text-right tabular">{fmtHM(e.plannedSec)}</td>
          <td className="h-9 px-2 text-right tabular">{fmtHM(e.actualSec)}</td>
          <td
            className={clsx(
              'h-9 px-2 text-right tabular',
              delta > e.plannedSec * 0.1 ? 'text-red' : 'text-muted',
            )}
          >
            {delta >= 0 ? '+' : '−'}
            {fmtHM(Math.abs(delta))}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
