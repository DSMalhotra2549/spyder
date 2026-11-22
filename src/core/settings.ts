// Settings keys and defaults (plan §5, P51, P57).
export interface Settings {
  goalSec: number;
  idleThresholdSec: number;
  checkInIntervalSec: number;
  nagIntervalSec: number;
  nudgeAfterSec: number;
  nudgeRepeatSec: number;
  nudgeResetSec: number;
  shortAwayIgnoreSec: number;
  defaultDirection: 'up' | 'down';
  hotkey: string;
  autostart: boolean;
  sampleIntervalSec: number;
  appPercentScope: 'work_hours' | 'all_day';
  keepWorkingStepMin: number;
  widgetPos: { x: number; y: number } | null;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  goalSec: 18000,
  idleThresholdSec: 300,
  checkInIntervalSec: 900,
  nagIntervalSec: 300,
  nudgeAfterSec: 300,
  nudgeRepeatSec: 300,
  nudgeResetSec: 60,
  shortAwayIgnoreSec: 60,
  defaultDirection: 'down',
  hotkey: 'Control+Alt+S',
  autostart: true,
  sampleIntervalSec: 2,
  appPercentScope: 'work_hours',
  keepWorkingStepMin: 30,
  widgetPos: null,
  theme: 'system',
};

export interface ScheduleRow {
  weekday: number; // 0 = Sunday (JS getDay)
  enabled: boolean;
  startMin: number;
  endMin: number;
}

export const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  enabled: weekday >= 1 && weekday <= 5,
  startMin: 600,
  endMin: 1020,
}));

/** Lower bounds for the numeric settings (seconds unless named otherwise). */
const MIN: Partial<Record<keyof Settings, number>> = {
  goalSec: 60,
  idleThresholdSec: 60,
  checkInIntervalSec: 300,
  nagIntervalSec: 60,
  nudgeAfterSec: 30,
  nudgeRepeatSec: 30,
  nudgeResetSec: 5,
  shortAwayIgnoreSec: 0,
  sampleIntervalSec: 1,
  keepWorkingStepMin: 5,
};

/** Upper bounds (P51: check-ins from 5 min to 3 h). */
const MAX: Partial<Record<keyof Settings, number>> = {
  checkInIntervalSec: 10_800,
};

const ENUMS: Partial<Record<keyof Settings, readonly unknown[]>> = {
  defaultDirection: ['up', 'down'],
  appPercentScope: ['work_hours', 'all_day'],
  theme: ['system', 'light', 'dark'],
};

/** Drops unknown keys and invalid values from a settings change; numbers are clamped to their range. */
export function cleanSettings(partial: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const key = k as keyof Settings;
    const def = DEFAULT_SETTINGS[key];
    if (key in MIN) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(MAX[key] ?? Infinity, Math.max(MIN[key]!, Math.round(v)));
    } else if (key in ENUMS) {
      if (ENUMS[key]!.includes(v)) out[k] = v;
    } else if (key === 'widgetPos') {
      if (v === null || (typeof v === 'object' && typeof (v as { x: unknown }).x === 'number' && typeof (v as { y: unknown }).y === 'number')) out[k] = v;
    } else if (key === 'hotkey') {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    } else if (typeof v === typeof def) out[k] = v;
  }
  return out as Partial<Settings>;
}
