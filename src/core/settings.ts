// Settings keys and defaults (plan §5, P31).
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
  widgetStyle: 'full' | 'compact';
}

export const DEFAULT_SETTINGS: Settings = {
  goalSec: 18000,
  idleThresholdSec: 300,
  checkInIntervalSec: 1800,
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
  widgetStyle: 'full',
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
