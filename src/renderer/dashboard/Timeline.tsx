// Day timeline, one track (P55, P64): blocks by whether they're accounted for, breaks and away muted, untracked hatched,
// a thin activity-category strip under it, distraction flags above. Hover shows details; clicking a
// session picks it (Today highlights its row in the session log).
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { DaySummary } from '../../core/aggregate';
import { fmtDuration, fmtTime } from '../../core/format';
import { CAT_COLOR, CAT_LABEL } from './parts';

export const AWAY_LABEL: Record<string, string> = {
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

/** The colour a block gets everywhere on Today: purple when accounted for, grey when not, break muted. */
export function blockColor(x: { kind: string; name: string | null }): string {
  if (x.kind === 'break') return 'var(--color-break)';
  return x.name ? 'var(--color-accent)' : 'var(--color-open)';
}

/** What a block was spent on, as shown everywhere (P60). */
export const answerText = (x: { kind: string; name: string | null }) => (x.kind === 'break' ? 'Break' : (x.name ?? 'Not accounted for'));

export function Timeline({
  s,
  nowMs,
  compact = false,
  selected = null,
  onPick,
}: {
  s: DaySummary;
  nowMs: number;
  compact?: boolean;
  selected?: string | null;
  onPick?: (sessionId: string) => void;
}) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const uid = useId().replace(/:/g, '');

  // Range: work window ±1 h (08:00–20:00 on a day off), widened to whole hours to fit all data.
  const win = s.window;
  let t0 = win ? win.startMs - H : s.dayStartMs + 8 * H;
  let t1 = win ? win.endMs + H : s.dayStartMs + 20 * H;
  const tl = s.timeline;
  for (const b of [...tl.segments, ...tl.away, ...tl.activity, ...s.untracked]) {
    t0 = Math.min(t0, b.startMs);
    t1 = Math.max(t1, b.endMs);
  }
  t0 = Math.max(s.dayStartMs, s.dayStartMs + Math.floor((t0 - s.dayStartMs) / H) * H);
  t1 = Math.min(s.dayEndMs, s.dayStartMs + Math.ceil((t1 - s.dayStartMs) / H) * H);
  const PAD = 18; // room for the first and last hour labels
  const plotW = Math.max(100, width - 2 * PAD);
  const x = (ms: number) => PAD + ((ms - t0) / (t1 - t0)) * plotW;
  const w = (a: number, b: number) => Math.max(1.5, x(b) - x(a));

  const L = compact
    ? { flag: 4, track: { y: 8, h: 20 }, strip: { y: 31, h: 3 }, axis: 48 }
    : { flag: 4, track: { y: 9, h: 30 }, strip: { y: 43, h: 4 }, axis: 64 };
  const height = L.axis + 4;
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += H) hours.push(t);
  const step = Math.ceil(hours.length / Math.max(1, Math.floor(plotW / 52)));

  const show = (e: React.MouseEvent, lines: string[]) => {
    const r = ref.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, lines });
  };
  const span = (a: number, b: number) => `${fmtTime(a)}–${fmtTime(b)} · ${fmtDuration((b - a) / 1000)}`;
  const showNow = nowMs >= t0 && nowMs <= t1;
  const { y: ty, h: th } = L.track;

  return (
    <div ref={ref} className="relative" data-testid="timeline" onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} className="block">
        <defs>
          <pattern id={`un${uid}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="var(--color-faint)" strokeWidth={1.5} opacity={0.6} />
          </pattern>
          <pattern id={`aw${uid}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={5} height={5} fill="var(--color-away)" opacity={0.15} />
            <line x1={0} y1={0} x2={0} y2={5} stroke="var(--color-away)" strokeWidth={1.5} opacity={0.7} />
          </pattern>
        </defs>

        {/* Work hours are the lit part of the track. */}
        <rect x={PAD} y={ty} width={plotW} height={th} rx={4} fill="var(--color-surface-2)" opacity={0.45} />
        {win && <rect x={x(win.startMs)} y={ty} width={w(win.startMs, win.endMs)} height={th} rx={4} fill="var(--color-surface-2)" />}
        {hours.map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={L.strip.y + L.strip.h + 2} y2={L.strip.y + L.strip.h + 6} stroke="var(--color-border-strong)" />
            {i % step === 0 && (
              <text x={x(t)} y={L.axis} fontSize={11} fill="var(--color-faint)" textAnchor="middle" className="tabular">
                {fmtTime(t)}
              </text>
            )}
          </g>
        ))}

        {s.untracked.map((b, i) => (
          <rect
            key={`u${i}`}
            data-block="untracked"
            x={x(b.startMs)}
            y={ty}
            width={w(b.startMs, b.endMs)}
            height={th}
            fill={`url(#un${uid})`}
            onMouseMove={(e) => show(e, ['Untracked', span(b.startMs, b.endMs)])}
          />
        ))}
        {tl.away.map((b, i) => (
          <rect
            key={`w${i}`}
            data-block="away"
            x={x(b.startMs)}
            y={ty}
            width={w(b.startMs, b.endMs)}
            height={th}
            rx={2}
            fill={b.classification === null ? `url(#aw${uid})` : 'var(--color-away)'}
            opacity={b.classification === null ? 1 : 0.35}
            onMouseMove={(e) =>
              show(e, [b.classification ? `Away · ${b.label ?? AWAY_LABEL[b.classification]}` : 'Away (not classified)', span(b.startMs, b.endMs)])
            }
          />
        ))}
        {tl.segments.map((b, i) => {
          const name = answerText(b);
          const isSel = selected === b.sessionId;
          const dim = selected !== null && !isSel;
          const isBreak = b.kind === 'break';
          return (
            <rect
              key={`s${i}`}
              data-block="session"
              data-session={b.sessionId}
              x={x(b.startMs)}
              y={ty}
              width={w(b.startMs, b.endMs)}
              height={th}
              rx={2}
              fill={blockColor(b)}
              opacity={(isBreak ? 0.4 : 1) * (dim ? 0.35 : 1)}
              stroke={isSel ? 'var(--color-text)' : 'var(--color-bg)'}
              strokeWidth={isSel ? 1.5 : 1}
              className={onPick ? 'cursor-pointer' : undefined}
              onClick={onPick ? () => onPick(b.sessionId) : undefined}
              onMouseMove={(e) => show(e, [name, span(b.startMs, b.endMs)])}
            />
          );
        })}
        {showNow && (
          <line x1={x(nowMs)} x2={x(nowMs)} y1={ty - 3} y2={L.strip.y + L.strip.h + 1} stroke="var(--color-accent)" strokeWidth={1.5} />
        )}

        {tl.activity.map((b, i) => (
          <rect
            key={`a${i}`}
            x={x(b.startMs)}
            y={L.strip.y}
            width={w(b.startMs, b.endMs)}
            height={L.strip.h}
            fill={CAT_COLOR[b.category]}
            onMouseMove={(e) => show(e, [b.key, `${CAT_LABEL[b.category]} · ${span(b.startMs, b.endMs)}`])}
          />
        ))}
        {s.flags.map((f, i) => (
          <path
            key={`f${i}`}
            data-block="flag"
            d={`M ${x(f.tsMs) - 3.5} ${L.flag - 3} L ${x(f.tsMs) + 3.5} ${L.flag - 3} L ${x(f.tsMs)} ${L.flag + 3} Z`}
            fill="var(--color-red)"
            onMouseMove={(e) => show(e, [`Distracted: ${f.target}`, `${fmtTime(f.tsMs)} · ${fmtDuration(f.continuousSec)} straight`])}
          />
        ))}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-control border border-border bg-surface px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-pop tabular"
          style={{ left: Math.max(0, Math.min(tip.x + 12, width - 220)), top: tip.y + 14 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i ? 'text-muted' : 'font-medium'}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
