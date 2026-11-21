import { app } from 'electron';
import { join } from 'node:path';

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
