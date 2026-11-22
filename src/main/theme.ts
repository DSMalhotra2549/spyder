// Light / Dark / System (P57). nativeTheme.themeSource drives `prefers-color-scheme` in every window,
// so the renderer's CSS tokens follow it live; only native window backgrounds need setting here.
import { nativeTheme } from 'electron';
import type { AppCtx } from './context';

/** Matches --color-bg in src/renderer/styles.css, so a window never flashes the other theme while loading. */
export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0E0E10' : '#FFFFFF');

export function applyTheme(ctx: AppCtx): void {
  nativeTheme.themeSource = ctx.settings.theme;
  const d = ctx.dashboard;
  if (d && !d.isDestroyed()) d.setBackgroundColor(windowBackground());
}
