// Day timeline (design/DESIGN.md §4 Today, row 2): sessions, away, activity and flag lanes.
import { useLayoutEffect, useRef, useState } from 'react';
import type { DaySummary } from '../../core/aggregate';
import { fmtDuration, fmtTime } from '../../core/format';
import type { Kind } from '../../core/types';
import { CAT_COLOR, CAT_LABEL } from './parts';

const KIND_COLOR: Record<Kind, string> = {
  planned: 'var(--color-planned)',
  timed: 'var(--color-timed)',
  open: 'var(--color-open)',
  break: 'var(--color-break)',
};
const AWAY_LABEL: Record<string, string> = {
  break: 'Break',
  meeting: 'Meeting / call',
  offline_work: 'Offline work',
  not_working: 'Not working',
  working: 'Working',
};

const H = 3_600_000;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

export function Timeline({ s, nowMs, compact = false }: { s: DaySummary; nowMs: number; compact?: boolean }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);

  // Range: work window ±1 h (08:00–20:00 on a day off), widened to whole hours to fit all data.
  const win = s.window;
  let t0 = win ? win.startMs - H : s.dayStartMs + 8 * H;
  let t1 = win ? win.endMs + H : s.dayStartMs + 20 * H;
  const tl = s.timeline;
  for (const b of [...tl.segments, ...tl.away, ...tl.activity]) {
    t0 = Math.min(t0, b.startMs);
    t1 = Math.max(t1, b.endMs);
  }
  t0 = Math.max(s.dayStartMs, s.dayStartMs + Math.floor((t0 - s.dayStartMs) / H) * H);
  t1 = Math.min(s.dayEndMs, s.dayStartMs + Math.ceil((t1 - s.dayStartMs) / H) * H);
  const GUTTER = compact ? 20 : 64;
  // Room on the right for the last hour label.
  const plotW = Math.max(100, width - GUTTER - 20);
  const x = (ms: number) => GUTTER + ((ms - t0) / (t1 - t0)) * plotW;
  const w = (a: number, b: number) => Math.max(1, x(b) - x(a));

  const lanes = compact
    ? { ses: { y: 4, h: 20 }, away: { y: 28, h: 10 }, act: { y: 42, h: 12 }, flag: 58, axis: 72 }
    : { ses: { y: 6, h: 28 }, away: { y: 40, h: 16 }, act: { y: 62, h: 20 }, flag: 90, axis: 112 };
  const height = lanes.axis + 14;
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += H) hours.push(t);
  const step = Math.ceil(hours.length / Math.max(1, Math.floor(plotW / 48)));

  const show = (e: React.MouseEvent, lines: string[]) => {
    const r = ref.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, lines });
  };
  const span = (a: number, b: number) => `${fmtTime(a)}–${fmtTime(b)} · ${fmtDuration((b - a) / 1000)}`;
  const showNow = nowMs >= t0 && nowMs <= t1;

  return (
    <div ref={ref} className="relative" data-testid="timeline" onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} className="block">
        <defs>
          <pattern id="hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} fill="var(--color-away)" opacity={0.25} />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-away)" strokeWidth={3} />
          </pattern>
        </defs>
        {/* off-hours shading */}
        {win ? (
          <>
            <rect x={GUTTER} y={0} width={Math.max(0, x(win.startMs) - GUTTER)} height={lanes.axis} fill="var(--color-surface-2)" opacity={0.6} />
            <rect x={x(win.endMs)} y={0} width={Math.max(0, x(t1) - x(win.endMs))} height={lanes.axis} fill="var(--color-surface-2)" opacity={0.6} />
          </>
        ) : (
          <rect x={GUTTER} y={0} width={plotW} height={lanes.axis} fill="var(--color-surface-2)" opacity={0.6} />
        )}
        {hours.map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={lanes.axis} stroke="var(--color-border)" />
            {i % step === 0 && (
              <text x={x(t)} y={lanes.axis + 11} fontSize={11} fill="var(--color-muted)" textAnchor="middle" className="tabular">
                {fmtTime(t)}
              </text>
            )}
          </g>
        ))}
        {!compact && (
          <g fontSize={11} fill="var(--color-muted)">
            <text x={0} y={lanes.ses.y + lanes.ses.h / 2 + 4}>Sessions</text>
            <text x={0} y={lanes.away.y + lanes.away.h / 2 + 4}>Away</text>
            <text x={0} y={lanes.act.y + lanes.act.h / 2 + 4}>Activity</text>
          </g>
        )}
        {tl.activity.map((b, i) => (
          <rect
            key={`a${i}`}
            x={x(b.startMs)}
            y={lanes.act.y}
            width={w(b.startMs, b.endMs)}
            height={lanes.act.h}
            fill={CAT_COLOR[b.category]}
            onMouseMove={(e) => show(e, [b.key, `${CAT_LABEL[b.category]} · ${span(b.startMs, b.endMs)}`])}
          />
        ))}
        {tl.away.map((b, i) => (
          <rect
            key={`w${i}`}
            x={x(b.startMs)}
            y={lanes.away.y}
            width={w(b.startMs, b.endMs)}
            height={lanes.away.h}
            rx={3}
            fill={b.classification === null ? 'url(#hatch)' : 'var(--color-away)'}
            onMouseMove={(e) =>
              show(e, [b.classification ? (b.label ?? AWAY_LABEL[b.classification]) : 'Away (not classified)', span(b.startMs, b.endMs)])
            }
          />
        ))}
        {tl.segments.map((b, i) => {
          const bw = w(b.startMs, b.endMs);
          const name = b.name ?? (b.kind === 'break' ? 'Break' : 'Unlabelled');
          return (
            <g key={`s${i}`} onMouseMove={(e) => show(e, [name, span(b.startMs, b.endMs)])}>
              <rect
                x={x(b.startMs)}
                y={lanes.ses.y}
                width={bw}
                height={lanes.ses.h}
                rx={4}
                fill={KIND_COLOR[b.kind]}
                opacity={b.kind === 'open' ? 0.7 : 1}
              />
              {!compact && bw >= 60 && (
                <text
                  x={x(b.startMs) + 6}
                  y={lanes.ses.y + lanes.ses.h / 2 + 4}
                  fontSize={11}
                  fontWeight={600}
                  fill="#0E0E12"
                >
                  {name.length * 6.5 > bw - 10 ? `${name.slice(0, Math.max(1, Math.floor((bw - 18) / 6.5)))}…` : name}
                </text>
              )}
            </g>
          );
        })}
        {s.flags.map((f, i) => (
          <path
            key={`f${i}`}
            d={`M ${x(f.tsMs) - 4} ${lanes.flag - 6} L ${x(f.tsMs) + 4} ${lanes.flag - 6} L ${x(f.tsMs)} ${lanes.flag + 1} Z`}
            fill="var(--color-red)"
            onMouseMove={(e) => show(e, [`Distracted: ${f.target}`, `${fmtTime(f.tsMs)} · ${fmtDuration(f.continuousSec)} straight`])}
          />
        ))}
        {showNow && <line x1={x(nowMs)} x2={x(nowMs)} y1={0} y2={lanes.axis} stroke="var(--color-red)" strokeWidth={1.5} />}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-chip border border-border-strong bg-surface-2 px-2 py-1 text-[12px] whitespace-nowrap tabular"
          style={{ left: Math.min(tip.x + 12, width - 200), top: tip.y + 12 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i ? 'text-muted' : ''}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
