import { app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Folder holding icon.png / UrlHelper.exe: project `resources/` in dev, process.resourcesPath when packaged. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

export function rendererUrl(hash: string): { url?: string; file?: string; hash: string } {
  const h = hash.replace(/^#?\/?/, '/');
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) return { url: `${dev}#${h}`, hash: h };
  return { file: join(__dirname, '../renderer/index.html'), hash: h };
}

/** True only for the app's own renderer page (any hash route). IPC and navigation from anything else are refused. */
export function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  const r = rendererUrl('/');
  const base = r.url ? new URL(r.url) : pathToFileURL(r.file!);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === base.protocol && u.host === base.host && u.pathname === base.pathname;
}
