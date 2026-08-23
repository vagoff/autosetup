param(
  [Parameter(Mandatory = $true)][string]$OneCExecutable,
  [Parameter(Mandatory = $true)][string]$ThinClientExecutable,
  [Parameter(Mandatory = $true)][string]$CompilerInfobase,
  [Parameter(Mandatory = $true)][string]$EpfPath,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$BuildLogPath,
  [Parameter(Mandatory = $true)][string]$ExecutionLogPath,
  [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
  [Parameter(Mandatory = $true)][string]$BuildEpfArguments,
  [Parameter(Mandatory = $true)][string]$RunEpfArguments
)

$ErrorActionPreference = 'Stop'

function Invoke-OneC {
  param([Parameter(Mandatory = $true)][string]$ArgumentLine, [Parameter(Mandatory = $true)][string]$Label, [Parameter(Mandatory = $true)][string]$LogPath)
  $process = Start-Process -FilePath $OneCExecutable -ArgumentList $ArgumentLine -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "${Label}: timed out after $TimeoutSeconds seconds; process $($process.Id) was stopped; see $LogPath"
  }
  if ([int]$process.ExitCode -ne 0) { throw "${Label}: 1C exited with $($process.ExitCode); see $LogPath" }
}

$staleProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq '1cv8.exe' -or $_.Name -eq '1cv8c.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf('\staging\1c-odata\', [StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($staleProcess in $staleProcesses) {
  Stop-Process -Id $staleProcess.ProcessId -Force -ErrorAction Stop
}

New-Item -ItemType Directory -Path $CompilerInfobase -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $BuildLogPath) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $ExecutionLogPath) -Force | Out-Null
Invoke-OneC -ArgumentLine ('CREATEINFOBASE File="' + $CompilerInfobase + '" /Out "' + $BuildLogPath + '"') -Label 'create OData publisher compiler infobase' -LogPath $BuildLogPath
Invoke-OneC -ArgumentLine $BuildEpfArguments -Label 'build OData publisher EPF' -LogPath $BuildLogPath
if (-not (Test-Path -LiteralPath $EpfPath -PathType Leaf)) { throw 'build OData publisher EPF: output file is missing' }

Remove-Item -LiteralPath $ResultPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path ($ResultPath + '.tmp') -Force | Out-Null
$process = Start-Process -FilePath $ThinClientExecutable -ArgumentList $RunEpfArguments -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  if ((Test-Path -LiteralPath $ResultPath -PathType Leaf) -and (Get-Item -LiteralPath $ResultPath).Length -gt 0) { break }
  Start-Sleep -Milliseconds 200
}
if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf) -or (Get-Item -LiteralPath $ResultPath).Length -eq 0) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  throw "run OData publisher EPF: result file was not written within $TimeoutSeconds seconds; see $ExecutionLogPath"
}
[Convert]::ToBase64String([IO.File]::ReadAllBytes($ResultPath))
