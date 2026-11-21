import { contextBridge, ipcRenderer } from 'electron';
import type { SpyderApi } from './api';

const invoke =
  (method: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`spyder:${method}`, ...args);

const on = (channel: string) => (cb: (v: unknown) => void) => {
  const fn = (_e: unknown, v: unknown) => cb(v);
  ipcRenderer.on(`spyder:${channel}`, fn);
  return () => ipcRenderer.removeListener(`spyder:${channel}`, fn);
};

const debugNames = ['state', 'setNow', 'advance', 'simulateIdle', 'simulateSuspend', 'simulateResume',
  'simulateLock', 'simulateUnlock', 'injectActivity', 'trayInfo', 'flush', 'triggerHotkey'] as const;

const api: SpyderApi = {
  getSettings: invoke('getSettings'),
  setSettings: invoke('setSettings'),
  hideWidget: invoke('hideWidget'),
  openDashboard: invoke('openDashboard'),
  onNavigate: on('navigate'),
  debug:
    process.env.SPYDER_DEBUG === '1'
      ? Object.fromEntries(
          debugNames.map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke('spyder:debug', n, ...args)]),
        )
      : undefined,
} as SpyderApi;

contextBridge.exposeInMainWorld('spyder', api);
