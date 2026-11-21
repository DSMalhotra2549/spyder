// The renderer-facing API exposed on window.spyder (plan §11). Grows phase by phase.
import type { Settings } from '../core/settings';

export type SettingsVM = Settings & { hotkeyOk: boolean; dataDir: string };

export interface DebugApi {
  state(): Promise<Record<string, unknown>>;
  setNow(ms: number): Promise<void>;
  advance(sec: number): Promise<void>;
  simulateIdle(lastInputMs: number): Promise<void>;
  simulateSuspend(): Promise<void>;
  simulateResume(): Promise<void>;
  simulateLock(): Promise<void>;
  simulateUnlock(): Promise<void>;
  injectActivity(sample: unknown): Promise<void>;
  trayInfo(): Promise<{ exists: boolean; tooltip: string; menu: string[] }>;
  flush(): Promise<void>;
  triggerHotkey(): Promise<void>;
}

export interface SpyderApi {
  getSettings(): Promise<SettingsVM>;
  setSettings(partial: Partial<Settings>): Promise<SettingsVM>;
  hideWidget(): Promise<void>;
  openDashboard(route?: string): Promise<void>;
  onNavigate(cb: (route: string) => void): () => void;
  debug?: DebugApi;
}

declare global {
  interface Window {
    spyder: SpyderApi;
  }
}
