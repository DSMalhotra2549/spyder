// Week page (plan §12, design/DESIGN.md §4 Week).
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
import { dayStartFromKey } from '../../core/schedule';
import {
  STACK_KEYS,
  stackTotal,
  topApps,
  weekDates,
  type DayLite,
  type DayStacks,
  type RangeVM,
} from '../../core/trends';
import { AppsList } from './Today';
import { EfficiencyTrend } from './charts';
import { CAT_COLOR, Card, StatCell, statIcon, StatStrip, TopBar, useLoader } from './parts';
import { dur, pct, rangeTexts } from './stats';

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

/** P80: the same strip as Today, productive first. */
export function RangeStats({ vm }: { vm: RangeVM }) {
  const t = rangeTexts(vm.days);
  return (
    <StatStrip cols={5}>
      <StatCell label="Productive" id="range-productive" icon={statIcon('target', 'icon-range-productive')} value={t.productive} sub={t.productiveSub} />
      <StatCell label="Work" id="range-work" icon={statIcon('briefcase', 'icon-range-work')} value={t.work} sub={t.workSub} />
      <StatCell label="Avg day score" id="range-score" icon={statIcon('star', 'icon-range-score')} value={t.score} sub="scheduled days" />
      <StatCell label="Efficiency" id="range-efficiency" icon={statIcon('gauge', 'icon-range-efficiency')} value={t.efficiency} sub={t.efficiencySub} />
      <StatCell label="Goals hit" id="range-goals" icon={statIcon('check', 'icon-range-goals')} value={t.goals} sub={`streak ${vm.streak} ${vm.streak === 1 ? 'day' : 'days'}`} />
    </StatStrip>
  );
}

/** P80: the efficiency chart only once some block in the range is rated. */
export const anyRated = (vm: RangeVM) => vm.days.some((d) => d.ratedSec > 0);

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
          <Card title="Apps & sites" right="Work hours" className="col-span-5">
            <AppsList rows={top} reload={reload} compact />
          </Card>
        </div>
        {anyRated(vm) && (
          <Card title="Efficiency" className="mt-4" right="by day">
            <EfficiencyTrend days={vm.days} />
          </Card>
        )}
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
          {dur(total)}
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
          <span className="ml-auto pl-4 tabular">{dur(d.stacks[k])}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-1 text-muted">
        Productive {dur(d.productiveSec)} · score {pct(d.score)}
        {d.goalMet && d.scheduled ? ' · goal met' : ''}
      </div>
    </div>
  );
}
