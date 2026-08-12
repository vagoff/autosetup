# Модуль: включить WinRM (PowerShell Remoting). Базовая возможность ОС,
# не Feature-on-Demand — работает без сети и без ограничений LTSC.
#
# -SkipNetworkProfileCheck: на свежей VM сетевой профиль интерфейса в
# момент первого входа не гарантированно "Domain"/"Private" (NLA определяет
# категорию по способности достучаться до контроллера домена/шлюза, а не
# по <NetworkLocation> из unattend), а Enable-PSRemoting без этого флага
# отказывается открывать firewall-правила на "Public"-подобном профиле.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

try {
  Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop
  Write-ComLog 'enable-winrm-access: OK'
} catch {
  Write-ComLog "enable-winrm-access: FAILED - $($_.Exception.Message)"
}
