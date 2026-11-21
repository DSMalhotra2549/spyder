// Phase 4: trigger a distraction nudge via injectActivity and screenshot the desktop so the
// Windows toast and the red widget are both visible.
// Usage: npm run build && npx tsx scripts/nudge-shot.ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { launch, SHOTS } from '../tests/e2e/helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Screenshot of one screen region. CaptureBlt is needed to include layered windows (the transparent
 * widget, toasts). Only the widget and toast regions are captured, so nothing else on screen is saved.
 */
function screenshot(file: string, region: { x: number; y: number; w: number; h: number }): void {
  // Graphics.CopyFromScreen rejects SRCCOPY|CAPTUREBLT, so BitBlt is called directly.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace G -Name D -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetDC(System.IntPtr h); [DllImport("user32.dll")] public static extern int ReleaseDC(System.IntPtr h, System.IntPtr dc); [DllImport("gdi32.dll")] public static extern bool BitBlt(System.IntPtr d, int x, int y, int w, int h, System.IntPtr s, int sx, int sy, int op);'
$bmp = New-Object System.Drawing.Bitmap ${region.w}, ${region.h}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dst = $g.GetHdc(); $src = [G.D]::GetDC([IntPtr]::Zero)
[void][G.D]::BitBlt($dst, 0, 0, ${region.w}, ${region.h}, $src, ${region.x}, ${region.y}, 0x40CC0020)
[void][G.D]::ReleaseDC([IntPtr]::Zero, $src); $g.ReleaseHdc($dst)
$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

async function main() {
  const s = await launch();
  try {
    await s.widget.waitForTimeout(1500);
    const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', title: 'Lofi - YouTube', browser: 'chrome' as const };
    await s.debug.injectActivity(yt);
    await s.debug.advance(300);
    await s.debug.injectActivity(yt);
    console.log('toasts', ((await s.debug.state()).host as { toastCount: number }).toastCount);
    await sleep(2500); // toast slide-in + widget pulse
    const wb = await s.app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#/widget'))!;
      return { bounds: w.getBounds(), work: screen.getPrimaryDisplay().bounds, scale: screen.getPrimaryDisplay().scaleFactor };
    });
    const k = wb.scale;
    const widgetFile = join(SHOTS, 'nudge-widget-desktop.png');
    screenshot(widgetFile, { x: Math.round(wb.bounds.x * k), y: Math.round(wb.bounds.y * k), w: Math.round(wb.bounds.width * k), h: Math.round(wb.bounds.height * k) });
    // Toasts appear in the bottom-right corner, above the taskbar.
    const toastFile = join(SHOTS, 'nudge-toast-desktop.png');
    const W = Math.round(wb.work.width * k);
    const H = Math.round(wb.work.height * k);
    screenshot(toastFile, { x: W - Math.round(420 * k), y: H - Math.round(300 * k), w: Math.round(420 * k), h: Math.round(300 * k) });
    console.log(widgetFile);
    console.log(toastFile);
  } finally {
    await s.close();
  }
}

void main();
