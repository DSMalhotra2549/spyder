// Prompt view models and copy for the block loop (P59, P60, P70).
import type { AskRow } from './asks';
import { fmtDuration, fmtTime } from './format';

/** An ended block waiting to be accounted for, with its hints. */
export interface PendingBlock {
  id: string;
  startMs: number;
  endMs: number;
  /** Minutes the user was away within the block (P61). */
  awaySec: number;
  /** Top apps or sites used in the block, most time first. */
  apps: string[];
  /** P95: a break block filled over time Spyder was asleep or off. */
  gap?: boolean;
}

export interface AccountBlockVM extends PendingBlock {
  range: string;
  length: string;
  hint: string | null;
}

export interface AccountVM {
  view: 'account';
  heading: string;
  title: string;
  blocks: AccountBlockVM[];
  /** The latest answer today, for "Same as last". */
  lastAnswer: string | null;
  /** The loop was cut by the end of work hours: offer Keep working (P62). */
  canContinue: boolean;
  /** P70: apps and sites used in these blocks that still want the user's label, most time first. */
  asks: AskRow[];
  askTitle: string;
}

/** P70: the prompt asks about at most this many apps and sites. */
export const PROMPT_ASKS = 3;

export interface ReminderVM {
  view: 'reminder';
  heading: string;
  title: string;
  body: string;
  lengthSec: number;
}

export type PromptVM = AccountVM | ReminderVM;

/** P95: the hint on a block filled over time Spyder was asleep or off. */
export const GAP_HINT = 'Computer asleep or off · a break until answered';

const range = (b: PendingBlock) => `${fmtTime(b.startMs)}–${fmtTime(b.endMs)}`;

export function blockHint(b: PendingBlock): string | null {
  const parts: string[] = [];
  if (b.gap) parts.push(GAP_HINT);
  if (b.awaySec >= 60) parts.push(`Away ${fmtDuration(b.awaySec)}`);
  if (b.apps.length) parts.push(b.apps.join(', '));
  return parts.length ? parts.join(' · ') : null;
}

export function accountView(blocks: PendingBlock[], lastAnswer: string | null, canContinue: boolean, asks: AskRow[] = []): AccountVM {
  const one = blocks.length === 1;
  return {
    view: 'account',
    heading: one ? 'Block ended' : `${blocks.length} blocks`,
    title: one ? `What did you do ${range(blocks[0])}?` : `What did you do in these ${blocks.length} blocks?`,
    blocks: blocks.map((b) => ({ ...b, range: range(b), length: fmtDuration(Math.round((b.endMs - b.startMs) / 1000)), hint: blockHint(b) })),
    lastAnswer,
    canContinue,
    asks: asks.slice(0, PROMPT_ASKS),
    askTitle: asks.length === 1 ? 'How does this count?' : 'How do these count?',
  };
}

export function reminderView(lengthSec: number): ReminderVM {
  return {
    view: 'reminder',
    heading: 'Not started',
    title: 'Work hours have started',
    body: `Press Start to begin ${fmtDuration(lengthSec)} blocks.`,
    lengthSec,
  };
}
