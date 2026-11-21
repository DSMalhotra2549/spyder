// Phase 4 capture check (plan §13): real foreground capture against the built app.
// Opens Notepad, Chrome (example.com) and Firefox (youtube.com), focuses each for 10 s, flushes,
// and checks the activity rows. Also measures UrlHelper latency with Chrome in front.
// Usage: npm run build && npx tsx scripts/capture-check.ts
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { launch, ROOT } from '../tests/e2e/helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ps(script: string): string {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`powershell failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** PID of the first process with a visible main window whose title matches. */
async function windowPid(name: string, titleLike: string): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const out = ps(
      `Get-Process ${name} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '${titleLike}' } | Select-Object -First 1 -ExpandProperty Id; exit 0`,
    );
    if (out) return Number(out);
    await sleep(500);
  }
  throw new Error(`no ${name} window like ${titleLike}`);
}

/**
 * Bring a process's main window to the front. AppActivate alone loses to Windows' foreground lock,
 * so a synthetic Alt press (which lifts the lock) plus SetForegroundWindow follows, verified.
 */
function focus(pid: number): void {
  const out = ps(`
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);'
$h = (Get-Process -Id ${pid}).MainWindowHandle
[void](New-Object -ComObject WScript.Shell).AppActivate(${pid})
for ($i = 0; $i -lt 10 -and [W.U]::GetForegroundWindow() -ne $h; $i++) {
  [W.U]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W.U]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  if ([W.U]::IsIconic($h)) { [void][W.U]::ShowWindow($h, 9) }
  [void][W.U]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 100
}
[W.U]::GetForegroundWindow() -eq $h`);
  if (out !== 'True') throw new Error(`could not focus pid ${pid}`);
}

function isForeground(pid: number): boolean {
  return (
    ps(`
Add-Type -Namespace W -Name F -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
(Get-Process -Id ${pid}).MainWindowHandle -eq [W.F]::GetForegroundWindow()`) === 'True'
  );
}

async function helperLatency(n: number): Promise<number[]> {
  const p = spawn(join(ROOT, 'resources/UrlHelper.exe'), [], { windowsHide: true });
  const lines = createInterface({ input: p.stdout })[Symbol.asyncIterator]();
  const times: number[] = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    p.stdin.write('fg\n');
    last = (await lines.next()).value as string;
    times.push(performance.now() - t);
  }
  p.kill();
  console.log(`  last helper reply: ${last}`);
  return times;
}

const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)];

async function main() {
  const s = await launch({ env: { SPYDER_CAPTURE: '1' } });
  console.log(`data dir: ${s.dataDir}`);
  try {
    ps(`Start-Process notepad; Start-Process chrome '--new-window','https://example.com'; Start-Process firefox '-new-window','https://www.youtube.com'`);
    const pids = {
      notepad: await windowPid('notepad', '*'),
      chrome: await windowPid('chrome', '*Example Domain*'),
      firefox: await windowPid('firefox', '*YouTube*'),
    };
    console.log('pids', pids);
    await sleep(3000); // let the pages settle
    let latency: number[] = [];
    // Only rows from the focus loop count (Chrome/Firefox also hold the foreground briefly at launch).
    const loopStart = (await s.debug.state()).now as number;
    for (const [name, pid] of Object.entries(pids)) {
      focus(pid);
      console.log(`focused ${name}`);
      if (name === 'chrome') {
        await sleep(1000);
        latency = await helperLatency(50);
        await sleep(9000 - latency.reduce((a, b) => a + b, 0));
      } else await sleep(10_000);
      if (!isForeground(pid)) console.warn(`  WARNING: ${name} lost focus during its 10 s (someone else used the machine?)`);
    }
    await s.debug.flush();
    console.log('tracker', (await s.debug.state()).tracker);

    const rows = s
      .db()
      .prepare('SELECT exe, domain, title, start_ms, end_ms FROM activity WHERE end_ms >= ? ORDER BY start_ms')
      .all(loopStart - 60_000) as { exe: string; domain: string | null; title: string | null; start_ms: number; end_ms: number }[];
    console.table(rows.map((r) => ({ ...r, sec: (r.end_ms - r.start_ms) / 1000 })));

    const want: [string, string | null][] = [
      ['notepad.exe', null],
      ['chrome.exe', 'example.com'],
      ['firefox.exe', 'youtube.com'],
    ];
    let pass = true;
    for (const [exe, domain] of want) {
      const sec = rows.filter((r) => r.exe === exe && r.domain === domain).reduce((a, r) => a + Math.max(0, r.end_ms - Math.max(r.start_ms, loopStart)) / 1000, 0);
      const ok = sec >= 8 && sec <= 12;
      pass &&= ok;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${exe} ${domain ?? ''} ${sec.toFixed(1)} s`);
    }
    const p50 = pct(latency, 0.5);
    const p95 = pct(latency, 0.95);
    const okLat = p95 < 150;
    pass &&= okLat;
    console.log(`${okLat ? 'PASS' : 'FAIL'} helper latency n=${latency.length} p50=${p50.toFixed(1)} ms p95=${p95.toFixed(1)} ms max=${Math.max(...latency).toFixed(1)} ms`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await s.close();
  }
}

void main();
