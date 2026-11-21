# The UI Automation helper targets .NET Framework 4.x and is built with Windows' own csc.exe

**Status:** accepted (2026-11-21)

Reading Chrome's address bar needs the Windows UI Automation API. The .NET SDK isn't installed on the dev machine. But every Windows 10/11 install ships .NET Framework 4.x, its C# compiler (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) and the UIA assemblies (`...\WPF\UIAutomationClient.dll`, `UIAutomationTypes.dll`, `WindowsBase.dll`). So `UrlHelper.cs` is a small console program built with that compiler. The result is an exe of about 20 KB, needs no installs, and runs on any Windows machine.

## Considered options
- **Install the .NET 8 SDK** (~250 MB) and build OpenTime's helper almost unchanged. Rejected: an extra install for the user, and a ~20 MB helper.
- **Call UIA from PowerShell for each sample.** Rejected: 300–800 ms per call, far too slow to run every 2 s.
- **UIA from Rust or a native Node addon.** Rejected: needs a native toolchain, which is the exact problem ADR-0003 avoids.
