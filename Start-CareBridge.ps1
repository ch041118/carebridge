$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$mutex = New-Object System.Threading.Mutex($false, 'Local\CareBridgeDesktopLauncher')
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(30000)
    if (-not $ownsMutex) { throw 'Another launch is in progress. Try again shortly.' }
    $port = 3100
    $envFile = Join-Path $appRoot '.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in [IO.File]::ReadAllLines($envFile)) {
            if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $port = [int]$Matches[1] }
        }
    }
    if ($port -lt 1024 -or $port -gt 65535) { throw 'PORT must be between 1024 and 65535.' }
    $url = "http://127.0.0.1:$port"
    function Get-Health {
        try { return Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2 } catch { return $null }
    }
    $health = Get-Health
    if ($health.app -eq 'carebridge' -and $health.version -eq '0.2.0') {
        Start-Process $url
        exit
    }
    $listener = New-Object Net.Sockets.TcpClient
    try { $listener.Connect('127.0.0.1', $port); $occupied = $true } catch { $occupied = $false } finally { $listener.Dispose() }
    if ($occupied) { throw "Port $port is occupied by another or older server. Stop that server first." }
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    }
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js 22 or newer is required.' }
    $version = & $node -p 'process.versions.node'
    if ([int]($version.Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
    $logs = Join-Path $appRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    $serverFile = Join-Path $appRoot 'server.mjs'
    $arguments = @("--env-file-if-exists=`"$envFile`"", "`"$serverFile`"")
    $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log')
    @{pid=$process.Id;server=$serverFile;started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'launcher.json') -Encoding UTF8
    for ($i=0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        $health = Get-Health
        if ($health.app -eq 'carebridge' -and $health.version -eq '0.2.0') { Start-Process $url; exit }
        $process.Refresh()
        if ($process.HasExited) { throw 'Server exited. Check logs/server-error.log.' }
    }
    throw 'Server did not become ready. Check the logs folder.'
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'CareBridge') | Out-Null
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
