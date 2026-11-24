// Line charts shared by Week and Month (design/DESIGN.md §4): a by-day trend and its tooltip.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dayEfficiency, type DayLite } from '../../core/trends';
import { Empty } from './parts';

export const axis = { tickLine: false, axisLine: false, tick: { fill: 'var(--color-muted)', fontSize: 11 } };

/** P75: each day's efficiency, on any day with rated blocks (days off too). */
export function EfficiencyTrend({ days }: { days: DayLite[] }) {
  const v = (d: DayLite) => dayEfficiency(d);
  return <Trend days={days} value={(d) => (v(d) === null ? null : Math.round(v(d)! * 100))} fmt={(x) => `${x}%`} unit="%" testId="trend-efficiency" domain={[0, 100]} anyDay dots />;
}

export function Trend({
  days,
  value,
  fmt,
  unit,
  testId,
  height = 150,
  color = 'var(--color-accent)',
  domain,
  anyDay = false,
  dots = false,
}: {
  days: DayLite[];
  value: (d: DayLite) => number | null;
  fmt: (v: number) => string;
  unit: string;
  testId: string;
  height?: number;
  color?: string;
  domain?: [number, number];
  /** Days off count too (otherwise only scheduled days). */
  anyDay?: boolean;
  /** A dot per day, so a lone day still shows. */
  dots?: boolean;
}) {
  // Only scheduled days up to today; days off and future days leave gaps.
  const data = days.map((d) => ({ label: d.date.slice(8), v: d.future || (!anyDay && !d.scheduled) ? null : value(d) }));
  if (!data.some((d) => d.v !== null)) return <Empty>No data</Empty>;
  return (
    <div data-testid={testId} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis width={36} {...axis} tickFormatter={(v: number) => `${v}${unit}`} allowDecimals={false} domain={domain} />
          <Tooltip content={<LineTip fmt={fmt} />} cursor={{ stroke: 'var(--color-border-strong)' }} />
          <Line
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={dots && { r: 3, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineTip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { value?: number | null }[];
  label?: string;
  fmt: (v: number) => string;
}) {
  const v = payload?.[0]?.value;
  if (!active || v === null || v === undefined) return null;
  return (
    <div className="rounded-chip border border-border-strong bg-surface-2 px-3 py-1.5 text-[12px] tabular">
      <span className="text-muted">Day {Number(label)}</span> · {fmt(v)}
    </div>
  );
}
