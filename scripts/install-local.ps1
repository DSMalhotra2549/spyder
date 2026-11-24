# Builds the installer from the current checkout and installs it over the local Spyder, then
# restarts it. Run by .githooks/pre-push after every successful push of main; also safe to run by hand
# (`npm run install:local`). Log: release/install-local.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force release | Out-Null
$log = Join-Path $root 'release/install-local.log'
$lock = Join-Path $root 'release/install-local.lock'
$pending = Join-Path $root 'release/install-local.pending'

function Write-Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -Append -Encoding utf8 $log }

# One run at a time. A push during a run leaves a flag, and the running one builds again after.
if (Test-Path $lock) {
  $holder = Get-Content $lock -ErrorAction SilentlyContinue
  if ($holder -and (Get-Process -Id $holder -ErrorAction SilentlyContinue)) {
    New-Item -ItemType File -Force $pending | Out-Null
    Write-Log "run $holder in progress; queued another build"
    exit 0
  }
}
Set-Content $lock $PID

try {
  do {
    Remove-Item $pending -ErrorAction SilentlyContinue
    $commit = (git rev-parse --short HEAD)
    Write-Log "building $commit"
    cmd /c "npm run dist >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "npm run dist failed (exit $LASTEXITCODE); the installed app is unchanged" }

    $setup = Get-ChildItem release -Filter 'Spyder Setup *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    # The installer can't replace a running exe. Spyder recovers from being stopped (plan §7 recovery).
    Get-Process Spyder -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    Write-Log "installing $($setup.Name)"
    $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "installer exited with $($p.ExitCode)" }

    $exe = Join-Path $env:LOCALAPPDATA 'Programs\spyder\Spyder.exe'
    Start-Process -FilePath $exe
    Write-Log "installed $commit and restarted Spyder"
  } while (Test-Path $pending)
} catch {
  Write-Log "FAILED: $_"
  exit 1
} finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
}
