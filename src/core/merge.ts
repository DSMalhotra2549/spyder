// Merges tracker samples into activity rows (plan §9.1).

export interface ActivitySampleRow {
  exe: string;
  appName: string;
  title: string | null;
  domain: string | null;
  browser: 'chrome' | 'firefox' | 'edge' | null;
  isPrivate: boolean;
}

export interface ActivityRow extends ActivitySampleRow {
  startMs: number;
  endMs: number;
}

export interface MergeState {
  open: ActivityRow | null;
  lastSampleMs: number;
}

export const initialMerge = (): MergeState => ({ open: null, lastSampleMs: 0 });

const MIN_ROW_MS = 1000;

const sameKey = (a: ActivitySampleRow, b: ActivitySampleRow) =>
  a.exe === b.exe && a.domain === b.domain && a.title === b.title && a.isPrivate === b.isPrivate;

function close(st: MergeState, endMs: number, intervalMs: number): ActivityRow | null {
  const o = st.open;
  if (!o) return null;
  const end = Math.max(o.startMs, Math.min(st.lastSampleMs + intervalMs, endMs));
  return end - o.startMs >= MIN_ROW_MS ? { ...o, endMs: end } : null;
}

/** Adds one sample. Returns the row it closed, if any (rows under 1 s are dropped). */
export function mergeSample(
  st: MergeState,
  s: ActivitySampleRow,
  tsMs: number,
  intervalMs: number,
): { state: MergeState; closed: ActivityRow | null } {
  const o = st.open;
  if (o && sameKey(o, s) && tsMs - st.lastSampleMs <= 2 * intervalMs + 1000) {
    return { state: { open: { ...o, endMs: tsMs }, lastSampleMs: tsMs }, closed: null };
  }
  return {
    state: { open: { ...s, startMs: tsMs, endMs: tsMs }, lastSampleMs: tsMs },
    closed: close(st, tsMs, intervalMs),
  };
}

/** Closes the open row, never past `capMs` (the last input time on idle/away/quit). */
export function flushMerge(st: MergeState, capMs: number, intervalMs: number): { state: MergeState; closed: ActivityRow | null } {
  return { state: initialMerge(), closed: close(st, capMs, intervalMs) };
}
