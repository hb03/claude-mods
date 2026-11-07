# Setzt den Titel des Konsolenfensters; Aufruf aus sitzungsname.sh mit -Titel "Claude · <Name>".
# Escape-Sequenzen aus Hooks oder der Statuszeile erreichen das Terminal nicht,
# deshalb hängt sich das Skript per Windows-API an die Konsole von claude.exe.
# Damit Claude Code den Titel nicht überschreibt: CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1.
param([string]$Titel)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Titel) { exit 0 }

Add-Type -Namespace W -Name K -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitleW(string t);
'@
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
while ($p -and $p.Name -ne 'claude.exe') { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" }
if (-not $p) { exit 0 }
[W.K]::FreeConsole() | Out-Null
if ([W.K]::AttachConsole([uint32]$p.ProcessId)) { [W.K]::SetConsoleTitleW($Titel) | Out-Null }
exit 0
