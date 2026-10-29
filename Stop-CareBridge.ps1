$ErrorActionPreference = 'Stop'
try {
    $file = Join-Path $PSScriptRoot 'logs\launcher.json'
    if (-not (Test-Path -LiteralPath $file)) { throw 'No desktop-launched server is recorded. Stop a terminal-launched server in its terminal.' }
    $state = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if (-not $process) { exit }
    $expected = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.mjs'))
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    if ($state.server -ne $expected -or $process.ProcessName -ne 'node' -or -not $info.CommandLine.Contains($expected) -or $process.StartTime.ToUniversalTime().ToString('o') -ne $state.started) {
        throw 'Process identity changed. No process was stopped.'
    }
    Stop-Process -Id $process.Id
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'CareBridge') | Out-Null
    exit 1
}
