/// <reference lib="dom" />
// Phase 8: the installed app, launched like a user would (no SPYDER_DEBUG). Runs only with SPYDER_EXE set.
import { _electron as electron, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { exeLaunch, freshDataDir, INSTALLED_EXE, shot, windowByHash } from './helpers';

test.skip(!INSTALLED_EXE, 'set SPYDER_EXE to the installed Spyder.exe');

test('installed app: widget shows, no debug hooks, autostart entry', async () => {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SPYDER_DATA_DIR: freshDataDir(),
    SPYDER_CAPTURE: '0',
  };
  delete env.SPYDER_DEBUG;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(exeLaunch(env));
  try {
    const widget = await windowByHash(app, 'widget');
    await widget.waitForFunction(() => !!window.spyder?.getSettings);
    expect(await widget.evaluate(() => window.spyder.debug === undefined)).toBe(true);
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
    // Shown on ready-to-show.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('#/widget') && w.isVisible()),
        ),
      )
      .toBe(true);
    await widget.waitForTimeout(500);
    await shot(widget, 'installed-widget');

    const run = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Spyder'], {
      encoding: 'utf8',
    });
    expect(run.toLowerCase()).toContain(INSTALLED_EXE!.toLowerCase());
  } finally {
    await app.close();
  }
});
