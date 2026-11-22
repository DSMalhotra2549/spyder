// Distraction nudge (plan §8, P13, P14).
import type { Settings } from './settings';

export type SampleCategory = 'productive' | 'neutral' | 'distracting' | 'uncategorized';

export interface NudgeSample {
  tsMs: number;
  category: SampleCategory;
  target: string;
  inWorkSession: boolean;
}

export interface NudgeState {
  distractStartMs: number | null;
  nonDistractStartMs: number | null;
  lastNudgeMs: number | null;
}

export interface Nudge {
  target: string;
  continuousSec: number;
}

export type NudgeSettings = Pick<Settings, 'nudgeAfterSec' | 'nudgeRepeatSec' | 'nudgeResetSec'>;

export const initialNudge = (): NudgeState => ({ distractStartMs: null, nonDistractStartMs: null, lastNudgeMs: null });

export function stepNudge(
  prev: NudgeState,
  s: NudgeSample,
  cfg: NudgeSettings,
): { state: NudgeState; nudge: Nudge | null; isDistracted: boolean } {
  if (!s.inWorkSession) return { state: initialNudge(), nudge: null, isDistracted: false };
  const st = { ...prev };
  if (s.category === 'distracting') {
    st.distractStartMs ??= s.tsMs;
    st.nonDistractStartMs = null;
  } else {
    st.nonDistractStartMs ??= s.tsMs;
    if (s.tsMs - st.nonDistractStartMs >= cfg.nudgeResetSec * 1000) {
      st.distractStartMs = null;
      st.lastNudgeMs = null;
    }
  }
  const distractedFor = st.distractStartMs === null ? 0 : s.tsMs - st.distractStartMs;
  const isDistracted = st.distractStartMs !== null && distractedFor >= cfg.nudgeAfterSec * 1000;
  let nudge: Nudge | null = null;
  if (isDistracted && (st.lastNudgeMs === null || s.tsMs - st.lastNudgeMs >= cfg.nudgeRepeatSec * 1000)) {
    nudge = { target: s.target, continuousSec: Math.round(distractedFor / 1000) };
    st.lastNudgeMs = s.tsMs;
  }
  return { state: st, nudge, isDistracted };
}

export function nudgeMessage(target: string, continuousSec: number): string {
  const n = Math.max(1, Math.round(continuousSec / 60));
  return `You're on ${target} while your block is running (${n} min)`;
}
