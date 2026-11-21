// Phase 4 soak (plan §13): run the built app with real capture for N minutes and sample CPU and
// working set of its whole process tree (main, renderers, utility probe, UrlHelper) via Get-Process.
// Usage: npm run build && npx tsx scripts/soak.ts [minutes=10]
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { launch } from '../tests/e2e/helpers.ts';

const minutes = Number(process.argv[2] ?? 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sample {
  t: number;
  cpuSec: number;
  wsMb: number;
  procs: number;
}

/** CPU seconds and working set summed over a process and all its descendants. */
function sample(rootPid: number): Sample {
  const script = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$ids = @(${rootPid}); $i = 0
while ($i -lt $ids.Count) { $p = $ids[$i]; $ids += @($all | Where-Object { $_.ParentProcessId -eq $p } | ForEach-Object { $_.ProcessId }); $i++ }
$ps = Get-Process -Id $ids -ErrorAction SilentlyContinue
'{0} {1} {2}' -f ($ps | Measure-Object -Property TotalProcessorTime -Sum).Count, (($ps | ForEach-Object { $_.TotalProcessorTime.TotalSeconds }) | Measure-Object -Sum).Sum, (($ps | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB)`;
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).stdout.trim();
  const [procs, cpuSec, wsMb] = out.split(' ').map(Number);
  return { t: Date.now(), cpuSec, wsMb, procs };
}

async function main() {
  const s = await launch({ env: { SPYDER_CAPTURE: '1', SPYDER_FAKE_IDLE: '0' } });
  const pid = s.app.process().pid!;
  const cores = cpus().length;
  try {
    await sleep(30_000); // warm-up: windows loaded, probe and helper started
    const samples: Sample[] = [sample(pid)];
    console.log(`pid ${pid}, ${cores} logical cores, ${samples[0].procs} processes, start ws ${samples[0].wsMb.toFixed(1)} MB`);
    const end = Date.now() + minutes * 60_000;
    while (Date.now() < end) {
      await sleep(30_000);
      const x = sample(pid);
      const prev = samples[samples.length - 1];
      samples.push(x);
      const pct = ((x.cpuSec - prev.cpuSec) / ((x.t - prev.t) / 1000) / cores) * 100;
      console.log(`${((x.t - samples[0].t) / 60_000).toFixed(1)} min  cpu ${pct.toFixed(2)} %  ws ${x.wsMb.toFixed(1)} MB  procs ${x.procs}`);
    }
    const a = samples[0];
    const b = samples[samples.length - 1];
    const wall = (b.t - a.t) / 1000;
    const cpuPct = ((b.cpuSec - a.cpuSec) / wall / cores) * 100;
    const cpuOneCore = ((b.cpuSec - a.cpuSec) / wall) * 100;
    const growth = b.wsMb - a.wsMb;
    const st = (await s.debug.state()).tracker as { samples: number };
    console.log(`\nwall ${(wall / 60).toFixed(1)} min, tracker samples ${st.samples}`);
    console.log(`${cpuPct < 2 ? 'PASS' : 'FAIL'} average CPU ${cpuPct.toFixed(2)} % of the machine (${cpuOneCore.toFixed(2)} % of one core)`);
    console.log(`${growth < 30 ? 'PASS' : 'FAIL'} working set ${a.wsMb.toFixed(1)} → ${b.wsMb.toFixed(1)} MB (growth ${growth.toFixed(1)} MB)`);
    process.exitCode = cpuPct < 2 && growth < 30 ? 0 : 1;
  } finally {
    await s.close();
  }
}

void main();
