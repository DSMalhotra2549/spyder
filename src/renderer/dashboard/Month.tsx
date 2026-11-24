// Month page (plan §12, design/DESIGN.md §4 Month): calendar heatmap, trend lines, KPI charts.
import { format } from 'date-fns';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtHM } from '../../core/format';
import { dayStartFromKey } from '../../core/schedule';
import { dayEfficiency, monthDates, type DayLite, type RangeVM } from '../../core/trends';
import { RangeStats } from './Week';
import { Card, Empty, TopBar, useLoader } from './parts';
import { pct } from './stats';

export function Month({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const m = monthDates(date);
  const [vm] = useLoader(() => window.spyder.getRange(m[0], m[m.length - 1]), m[0]);
  if (!vm) return <TopBar title="Month" />;
  return (
    <>
      <TopBar title="Month" date={date} today={vm.today} onDate={onDate} unit="month" />
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-6" data-testid="month">
        <RangeStats vm={vm} />
        <div className="mt-4 grid grid-cols-12 gap-4">
          <Card
            title="Productive hours"
            right={`goal ${fmtHM(vm.days[0]?.goalSec ?? 0)}`}
            className="col-span-5"
          >
            <Heatmap days={vm.days} />
          </Card>
          <div className="col-span-7 flex min-w-0 flex-col gap-4">
            <Card title="Productive time">
              <Trend
                days={vm.days}
                value={(d) => d.productiveSec / 3600}
                fmt={(v) => fmtHM(v * 3600)}
                unit="h"
                testId="trend-productive"
              />
            </Card>
            <Card title="Day score">
              <Trend
                days={vm.days}
                value={(d) => (d.score === null ? null : Math.round(d.score * 100))}
                fmt={(v) => `${v}%`}
                unit="%"
                testId="trend-score"
              />
            </Card>
            <Card title="Efficiency">
              <EfficiencyTrend days={vm.days} />
            </Card>
          </div>
        </div>
        <KpiCharts vm={vm} />
      </div>
    </>
  );
}

const CELL = 44;
const GAP = 6;

function Heatmap({ days }: { days: DayLite[] }) {
  if (!days.length) return null;
  // Monday-first column of the 1st.
  const lead = (new Date(dayStartFromKey(days[0].date)).getDay() + 6) % 7;
  const rows = Math.ceil((lead + days.length) / 7);
  const w = 7 * CELL + 6 * GAP;
  const h = 18 + rows * (CELL + GAP) - GAP;
  return (
    <div className="mx-auto" style={{ maxWidth: w }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" data-testid="heatmap">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((l, i) => (
          <text
            key={l}
            x={i * (CELL + GAP) + CELL / 2}
            y={11}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-muted)"
          >
            {l}
          </text>
        ))}
        {days.map((d, i) => {
          const c = (lead + i) % 7;
          const r = Math.floor((lead + i) / 7);
          const x = c * (CELL + GAP);
          const y = 18 + r * (CELL + GAP);
          const frac = d.goalSec > 0 ? Math.min(1, d.productiveSec / d.goalSec) : 0;
          const empty = d.future || !d.scheduled;
          const tip = d.future
            ? format(dayStartFromKey(d.date), 'EEE, MMM d')
            : `${format(dayStartFromKey(d.date), 'EEE, MMM d')} · productive ${fmtHM(d.productiveSec)} · score ${pct(d.score)}${d.goalMet ? ' · goal met' : ''}${d.scheduled ? '' : ' · day off'}`;
          return (
            <g
              key={d.date}
              data-testid="heat-cell"
              data-date={d.date}
              data-goal={d.goalMet && !d.future ? '1' : '0'}
            >
              <title>{tip}</title>
              {empty && frac === 0 ? (
                <rect
                  x={x + 0.5}
                  y={y + 0.5}
                  width={CELL - 1}
                  height={CELL - 1}
                  rx={6}
                  fill="none"
                  stroke="var(--color-border)"
                />
              ) : (
                <>
                  <rect x={x} y={y} width={CELL} height={CELL} rx={6} fill="var(--color-surface-2)" />
                  {frac > 0 && (
                    <rect
                      x={x}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={6}
                      fill="var(--color-accent)"
                      opacity={0.15 + 0.85 * frac}
                    />
                  )}
                </>
              )}
              <text
                x={x + 6}
                y={y + 15}
                fontSize={11}
                fill={d.future ? 'var(--color-faint)' : frac > 0.5 ? 'var(--color-on-accent)' : 'var(--color-text)'}
                className="tabular"
              >
                {Number(d.date.slice(8))}
              </text>
              {d.goalMet && !d.future && (
                <circle cx={x + CELL - 9} cy={y + CELL - 9} r={3.5} fill="var(--color-green)" stroke="var(--color-surface)" strokeWidth={1.5} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const axis = { tickLine: false, axisLine: false, tick: { fill: 'var(--color-muted)', fontSize: 11 } };

/** P75: each day's efficiency, on any day with rated blocks (days off too). */
export function EfficiencyTrend({ days }: { days: DayLite[] }) {
  const v = (d: DayLite) => dayEfficiency(d);
  return <Trend days={days} value={(d) => (v(d) === null ? null : Math.round(v(d)! * 100))} fmt={(x) => `${x}%`} unit="%" testId="trend-efficiency" domain={[0, 100]} anyDay dots />;
}

function Trend({
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

function LineTip({
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

function KpiCharts({ vm }: { vm: RangeVM }) {
  if (!vm.kpis.length) return null;
  return (
    <div className="mt-4 grid grid-cols-12 gap-4">
      {vm.kpis.map((k) => {
        const byDate = new Map(vm.kpiValues.filter((p) => p.kpiId === k.id).map((p) => [p.date, p.value]));
        const days = vm.days;
        const data = days.map((d) => ({ label: d.date.slice(8), v: byDate.get(d.date) ?? null }));
        const total = [...byDate.values()].reduce((t, v) => t + v, 0);
        return (
          <Card
            key={k.id}
            title={k.name}
            right={
              byDate.size
                ? `${byDate.size} days · avg ${(total / byDate.size).toFixed(1)}${k.unit ? ` ${k.unit}` : ''}`
                : undefined
            }
            className="col-span-4"
            testId="kpi-chart"
          >
            {byDate.size === 0 ? (
              <Empty>No values this month</Empty>
            ) : (
              <div style={{ height: 120 }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis width={30} {...axis} allowDecimals={false} tickCount={3} />
                    <Tooltip
                      content={<LineTip fmt={(v) => `${v}${k.unit ? ` ${k.unit}` : ''}`} />}
                      cursor={{ stroke: 'var(--color-border-strong)' }}
                    />
                    <Line
                      dataKey="v"
                      stroke="var(--color-planned)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
