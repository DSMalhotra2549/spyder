/// <reference lib="dom" />
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DebugApi } from '../../src/preload/api';

export const ROOT = resolve(__dirname, '../..');
export const SHOTS = join(ROOT, 'tests/e2e/__shots__');
mkdirSync(SHOTS, { recursive: true });

export interface LaunchOpts {
  now?: string;
  scale?: number;
  dataDir?: string;
  env?: Record<string, string>;
}

export interface Launched {
  app: ElectronApplication;
  dataDir: string;
  widget: Page;
  dashboard: Page;
  prompt: Page;
  debug: DebugApi;
  db: () => DatabaseSync;
  close: () => Promise<void>;
}

export const freshDataDir = () => mkdtempSync(join(tmpdir(), 'spyder-e2e-'));

export async function windowByHash(app: ElectronApplication, hash: string, timeout = 15_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => p.url().includes(`#/${hash}`));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`window #/${hash} not found; have: ${app.windows().map((p) => p.url()).join(', ')}`);
}

/** SPYDER_EXE=<installed Spyder.exe> runs the same specs against the packaged app (plan Phase 8). */
export const INSTALLED_EXE = process.env.SPYDER_EXE;
export const exeLaunch = (env: Record<string, string>) =>
  INSTALLED_EXE
    ? { executablePath: INSTALLED_EXE, args: [], env, cwd: ROOT }
    : { args: [join(ROOT, 'out/main/index.js')], env, cwd: ROOT };

export async function launch(opts: LaunchOpts = {}): Promise<Launched> {
  const dataDir = opts.dataDir ?? freshDataDir();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SPYDER_DEBUG: '1',
    SPYDER_DATA_DIR: dataDir,
    SPYDER_NOW: opts.now ?? '2026-11-24T11:00:00',
    SPYDER_CLOCK_SCALE: String(opts.scale ?? 1),
    SPYDER_FAKE_IDLE: '1',
    SPYDER_CAPTURE: '0',
    ...opts.env,
  };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(exeLaunch(env));
  const widget = await windowByHash(app, 'widget');
  const dashboard = await windowByHash(app, 'dashboard');
  const prompt = await windowByHash(app, 'prompt');
  await widget.waitForLoadState('domcontentloaded');
  await widget.waitForFunction(() => !!window.spyder?.debug);

  const debug = new Proxy({} as DebugApi, {
    get:
      (_t, name: string) =>
      (...args: unknown[]) =>
        widget.evaluate(
          ([n, a]) => (window.spyder.debug as unknown as Record<string, (...x: unknown[]) => unknown>)[n](...a),
          [name, args] as const,
        ),
  });

  let handle: DatabaseSync | undefined;
  return {
    app,
    dataDir,
    widget,
    dashboard,
    prompt,
    debug,
    db: () => (handle ??= new DatabaseSync(join(dataDir, 'spyder.db'))),
    close: async () => {
      handle?.close();
      await app.close();
    },
  };
}

export const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** `npm run seed` into a data dir (scripts/seed.ts). */
export function seed(dataDir: string, days: number, to: string): void {
  const r = spawnSync('npx', ['tsx', 'scripts/seed.ts', '--days', String(days), '--to', to], {
    cwd: ROOT,
    env: { ...process.env, SPYDER_DATA_DIR: dataDir },
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}${r.stdout}`);
}
