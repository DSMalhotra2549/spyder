// Duration formatting (design/DESIGN.md §5).
const pad = (n: number) => String(n).padStart(2, '0');

/** Timer display: `mm:ss` under an hour, `h:mm:ss` above. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Tables: `h:mm`. */
export function fmtHM(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Bar widget label (P46): whole if it fits `max` chars, else the first word + `…` (cut if still too long). */
export function barLabel(label: string, max = 12): string {
  const s = label.trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const first = s.split(' ')[0];
  return first.length < max ? `${first}…` : `${first.slice(0, max - 1)}…`;
}

/** Prose: `1h 12m`, `38m`, `2h`, `45s`. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m`;
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

/** Local `HH:mm`. */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
