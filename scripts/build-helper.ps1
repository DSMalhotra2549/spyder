# Builds resources\UrlHelper.exe with the .NET Framework compiler (plan §9.2, ADR-0008).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
New-Item -ItemType Directory -Force resources | Out-Null
& "$fw\csc.exe" /nologo /target:exe /platform:x64 /optimize+ /out:resources\UrlHelper.exe `
  /r:"$fw\WPF\UIAutomationClient.dll" /r:"$fw\WPF\UIAutomationTypes.dll" /r:"$fw\WPF\WindowsBase.dll" src\native\UrlHelper.cs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built resources\UrlHelper.exe"
