$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell
$definitions = @(
    @{Name='케어브릿지 실행'; File='Start-CareBridge.ps1'; Icon=44},
    @{Name='케어브릿지 종료'; File='Stop-CareBridge.ps1'; Icon=27},
    @{Name='케어브릿지 사용안내'; File='사용안내.html'; Icon=23}
)
foreach ($definition in $definitions) {
    $linkPath = Join-Path $desktop ($definition.Name + '.lnk')
    $target = Join-Path $PSScriptRoot $definition.File
    if (-not (Test-Path -LiteralPath $target)) { throw "Missing target: $target" }
    $shortcut = $shell.CreateShortcut($linkPath)
    $isGuide = $definition.File.EndsWith('.html')
    if ((Test-Path -LiteralPath $linkPath) -and $shortcut.TargetPath -ne $target -and -not $shortcut.Arguments.Contains($target)) { throw "An unrelated shortcut already exists: $linkPath" }
    $shortcut.TargetPath = $(if ($isGuide) { $target } else { $powershell })
    $shortcut.Arguments = $(if ($isGuide) { '' } else { "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$target`"" })
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',' + $definition.Icon
    $shortcut.Description = $definition.Name
    $shortcut.Save()
    Write-Output $linkPath
}
