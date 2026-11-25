// System toasts (nudge, plan §8). Needs app.setAppUserModelId (plan §3).
import { Notification } from 'electron';
import { QUIET } from './windows';

export function toast(body: string): void {
  if (QUIET || !Notification.isSupported()) return;
  new Notification({ title: 'Spyder', body, silent: false }).show();
}
