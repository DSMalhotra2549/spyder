// Report and review view models (plan §11 getDay / getReview, P24).
import type { DaySummary } from './aggregate';

export interface DayVM {
  date: string;
  today: string;
  nowMs: number;
  summary: DaySummary;
  streak: number;
}

export interface ReviewItem {
  id: string;
  date: string;
  kind: 'win' | 'improve';
  text: string;
  sort: number;
}

export interface Kpi {
  id: string;
  name: string;
  unit: string | null;
  archived: boolean;
  sort: number;
}

export interface ReviewVM {
  date: string;
  today: string;
  summary: DaySummary;
  completedMs: number | null;
  /** P98: when the midnight card was saved or skipped for this day. */
  reflectedMs: number | null;
  items: ReviewItem[];
  kpis: Kpi[];
  kpiValues: Record<string, number>;
  leftoverCount: number;
}

/** Unlabelled finished sessions plus away periods still waiting for a classification. */
export const leftovers = (s: DaySummary) => s.unlabelledCount + s.away.filter((a) => a.classification === null).length;
