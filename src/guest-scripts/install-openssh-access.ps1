# Модуль: поставить автономный Win32-OpenSSH с USB и включить вход по
# ключу host → guest. Никаких Add-WindowsCapability, DISM или обращения к
# Windows Update: единственный входной пакет — закреплённый ZIP на том же
# removable-носителе, что autounattend.xml.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

$archivePath = Join-Path $PSScriptRoot '{{OPENSSH_ARCHIVE_FILENAME}}'
$openSshDirectory = Join-Path $env:ProgramFiles '{{OPENSSH_INSTALLATION_DIRECTORY_NAME}}'
$installerScriptPath = Join-Path $openSshDirectory 'install-sshd.ps1'
$defaultSshdConfigPath = Join-Path $openSshDirectory 'sshd_config_default'
$sshdConfigDirectory = Join-Path $env:ProgramData 'ssh'
$sshdConfigPath = Join-Path $sshdConfigDirectory 'sshd_config'
$publicKeyPath = Join-Path $PSScriptRoot '{{OPENSSH_CLIENT_PUBLIC_KEY_FILENAME}}'
$authorizedKeysPath = Join-Path $env:ProgramData "ssh\{{OPENSSH_ADMIN_AUTHORIZED_KEYS_FILENAME}}"

Write-ComLog 'install-openssh-access: start'

try {
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw "OpenSSH archive not found: $archivePath"
  }
  if (Test-Path -LiteralPath $openSshDirectory) {
    throw "OpenSSH destination already exists: $openSshDirectory"
  }
  if (-not (Test-Path -LiteralPath $publicKeyPath -PathType Leaf)) {
    throw "SSH client public key not found: $publicKeyPath"
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $env:ProgramFiles -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $installerScriptPath -PathType Leaf)) {
    throw "OpenSSH installer script not found after extraction: $installerScriptPath"
  }

  & $installerScriptPath
  if (-not $?) {
    throw "OpenSSH installer failed: $installerScriptPath"
  }
  if (-not (Test-Path -LiteralPath $defaultSshdConfigPath -PathType Leaf)) {
    throw "OpenSSH default sshd_config not found: $defaultSshdConfigPath"
  }
  if (-not (Test-Path -LiteralPath $sshdConfigPath -PathType Leaf)) {
    New-Item -ItemType Directory -Path $sshdConfigDirectory -Force -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $defaultSshdConfigPath -Destination $sshdConfigPath -ErrorAction Stop
  }

  $service = Get-Service -Name '{{OPENSSH_SERVICE_NAME}}' -ErrorAction Stop
  Set-Service -Name $service.Name -StartupType Automatic -ErrorAction Stop

  $rule = Get-NetFirewallRule -Name '{{OPENSSH_FIREWALL_RULE_NAME}}' -ErrorAction SilentlyContinue
  if ($rule) {
    Set-NetFirewallRule -Name $rule.Name -Enabled True -Direction Inbound -Action Allow -Profile Any -ErrorAction Stop
    Set-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -Protocol TCP -LocalPort {{OPENSSH_PORT}} -ErrorAction Stop
  } else {
    New-NetFirewallRule -Name '{{OPENSSH_FIREWALL_RULE_NAME}}' -DisplayName '{{OPENSSH_FIREWALL_RULE_DISPLAY_NAME}}' -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort {{OPENSSH_PORT}} -Profile Any -ErrorAction Stop | Out-Null
  }

  $publicKey = (Get-Content -LiteralPath $publicKeyPath -Raw -ErrorAction Stop).Trim()
  if ($publicKey -notmatch '^ssh-rsa\s+') {
    throw 'SSH client public key has an unsupported format'
  }
  Set-Content -LiteralPath $authorizedKeysPath -Value $publicKey -Encoding ascii -NoNewline -ErrorAction Stop
  & icacls.exe $authorizedKeysPath '/inheritance:r' '/grant:r' '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "icacls failed with exit code $LASTEXITCODE"
  }

  & (Join-Path $openSshDirectory 'ssh-keygen.exe') -A
  if ($LASTEXITCODE -ne 0) {
    throw "OpenSSH host-key generation failed with exit code $LASTEXITCODE"
  }
  & (Join-Path $openSshDirectory 'sshd.exe') -t
  if ($LASTEXITCODE -ne 0) {
    throw "sshd configuration validation failed with exit code $LASTEXITCODE"
  }
  $service = Get-Service -Name $service.Name -ErrorAction Stop
  if ($service.Status -ne 'Running') {
    Start-Service -Name $service.Name -ErrorAction Stop
  }
  Write-ComLog 'install-openssh-access: OK'
} catch {
  Write-ComLog "install-openssh-access: FAILED - $($_.Exception.Message)"
  throw
}
