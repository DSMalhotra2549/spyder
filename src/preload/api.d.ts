// The renderer-facing API exposed on window.spyder (plan §11). Grows phase by phase.
import type { PromptVM } from '../core/promptView';
import type { WidgetVM } from '../core/sessionEngine';
import type { Settings } from '../core/settings';
import type { Answer, EngineError, Kind, StartInput } from '../core/types';

export type SettingsVM = Settings & { hotkeyOk: boolean; dataDir: string };

export interface WidgetPayload extends WidgetVM {
  style: 'full' | 'compact';
  distractTarget: string | null;
  distractSec: number;
}

export type PromptWindowState =
  | { view: 'start'; defaultDirection: 'up' | 'down'; tab: Kind }
  | { view: 'prompt'; prompt: PromptVM }
  | null;

export type Ok = { ok: true };
export type StartResult = Ok | (EngineError & { elapsedSec?: number });

export interface Project {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

export interface DebugApi {
  state(): Promise<Record<string, unknown>>;
  setNow(ms: number): Promise<void>;
  advance(sec: number): Promise<void>;
  setScale(scale: number): Promise<void>;
  tick(): Promise<void>;
  simulateIdle(lastInputMs: number | null): Promise<void>;
  simulateSuspend(): Promise<void>;
  simulateResume(): Promise<void>;
  simulateLock(): Promise<void>;
  simulateUnlock(): Promise<void>;
  injectActivity(sample: {
    exe: string;
    appName?: string;
    domain: string | null;
    title: string | null;
    browser: 'chrome' | 'firefox' | 'edge' | null;
  }): Promise<string>;
  trayInfo(): Promise<{ exists: boolean; tooltip: string; menu: string[] }>;
  flush(): Promise<void>;
  killProbe(): Promise<void>;
  triggerHotkey(): Promise<void>;
}

export interface SpyderApi {
  getSettings(): Promise<SettingsVM>;
  setSettings(partial: Partial<Settings>): Promise<SettingsVM>;

  getWidget(): Promise<WidgetPayload>;
  onWidget(cb: (w: WidgetPayload) => void): () => void;
  onRing(cb: () => void): () => void;
  start(input: StartInput): Promise<StartResult>;
  done(): Promise<Ok | EngineError>;
  extend(sec: number): Promise<Ok | EngineError>;
  pause(): Promise<Ok | EngineError>;
  resume(): Promise<Ok | EngineError>;
  label(sessionId: string, name: string, projectId: string | null): Promise<Ok | EngineError>;
  keepWorking(): Promise<Ok | EngineError>;

  getPrompt(): Promise<PromptWindowState>;
  onPrompt(cb: (p: PromptWindowState) => void): () => void;
  answer(promptId: string, answer: Answer): Promise<Ok | EngineError>;
  openStart(tab?: Kind): Promise<void>;
  closeStart(): Promise<void>;

  nameSuggestions(prefix: string): Promise<string[]>;
  listProjects(): Promise<Project[]>;
  saveProject(p: { id?: string; name: string; color?: string }): Promise<Project>;

  hideWidget(): Promise<void>;
  openDashboard(route?: string): Promise<void>;
  widgetLayout(layout: 'collapsed' | 'expanded' | 'hover'): Promise<void>;
  resizePrompt(height: number): Promise<void>;
  onNavigate(cb: (route: string) => void): () => void;
  debug?: DebugApi;
}

declare global {
  interface Window {
    spyder: SpyderApi;
  }
}
