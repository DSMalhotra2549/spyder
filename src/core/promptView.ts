// Prompt view model and copy (plan §12 "Prompt copy"; strings are exact).
import { fmtDuration, fmtTime } from './format';
import type { Prompt, PromptType } from './types';

export interface SessionInfo {
  name: string | null;
  elapsedSec: number;
  plannedSec: number | null;
}

export type PromptForm = 'none' | 'label' | 'checkIn' | 'away';

export interface PromptVM {
  id: string;
  type: PromptType;
  /** Caps header label. */
  heading: string;
  title: string;
  body: string | null;
  form: PromptForm;
  sessionId: string | null;
  /** checkIn: the session already has a name ("Still on X?"). */
  labelled: boolean;
  name: string | null;
  index: number;
  count: number;
}

const HEADINGS: Record<PromptType, string> = {
  timeUp: "Time's up",
  label: 'Label',
  checkIn: 'Check-in',
  away: 'Away',
  recovery: 'Not running',
  breakEnd: "Break's over",
};

export function promptView(p: Prompt, count: number, info: SessionInfo | null): PromptVM {
  const name = info?.name ?? null;
  const elapsed = fmtDuration(info?.elapsedSec ?? 0);
  const planned = fmtDuration(info?.plannedSec ?? 0);
  const base = {
    id: p.id,
    type: p.type,
    heading: HEADINGS[p.type],
    sessionId: p.sessionId ?? null,
    labelled: false,
    name,
    index: 1,
    count,
  };
  switch (p.type) {
    case 'timeUp':
      return {
        ...base,
        title: `Time's up: ${name ?? 'Untitled session'}`,
        body: `Planned ${planned}. Done, or need more time?`,
        form: 'none',
      };
    case 'label':
      return { ...base, title: `What did you do for the last ${elapsed}?`, body: null, form: 'label' };
    case 'checkIn':
      return name
        ? { ...base, labelled: true, title: `Still on ${name}?`, body: null, form: 'checkIn' }
        : { ...base, title: `What have you been doing for the last ${elapsed}?`, body: null, form: 'checkIn' };
    case 'away': {
      const s = p.awayStartMs ?? 0;
      const e = p.awayEndMs ?? 0;
      return {
        ...base,
        title: `You were away ${fmtDuration((e - s) / 1000)}`,
        body: `${fmtTime(s)}–${fmtTime(e)}`,
        form: 'away',
      };
    }
    case 'recovery':
      return {
        ...base,
        title: `Spyder wasn't running from ${fmtTime(p.awayStartMs ?? 0)} to ${fmtTime(p.awayEndMs ?? 0)}`,
        body: null,
        form: 'away',
      };
    case 'breakEnd':
      return { ...base, title: `Break's over (${planned})`, body: null, form: 'none' };
  }
}
