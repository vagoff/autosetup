# Модуль: сохранить serial command agent в ProgramData и запустить его
# отдельным фоновым PowerShell-процессом. Этот скрипт быстро завершается,
# поэтому не блокирует очередь FirstLogonCommands.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

$agentSourcePath = Join-Path $PSScriptRoot '{{SERIAL_AGENT_SCRIPT_FILENAME}}'
$installationDirectory = Join-Path $env:ProgramData '{{SERIAL_AGENT_INSTALLATION_DIRECTORY_NAME}}'
$agentInstalledPath = Join-Path $installationDirectory '{{SERIAL_AGENT_SCRIPT_FILENAME}}'

Write-ComLog 'install-serial-command-agent: start'

try {
  if (-not (Test-Path -LiteralPath $agentSourcePath -PathType Leaf)) {
    throw "serial command agent source not found: $agentSourcePath"
  }
  if (Test-Path -LiteralPath $agentInstalledPath -PathType Leaf) {
    throw "serial command agent already exists: $agentInstalledPath"
  }
  New-Item -ItemType Directory -Path $installationDirectory -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $agentSourcePath -Destination $agentInstalledPath -ErrorAction Stop
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $agentInstalledPath
  ) -WindowStyle Hidden -ErrorAction Stop
  Write-ComLog 'install-serial-command-agent: OK'
} catch {
  Write-ComLog "install-serial-command-agent: FAILED - $($_.Exception.Message)"
  throw
}
