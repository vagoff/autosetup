# Модуль: включить RDP (Remote Desktop) для человека. Не для агента —
# агент ходит по SSH/serial-agent, это отдельный вход поверх сети для
# визуальной проверки/экспериментов наравне со SPICE/VNC (см.
# qemu.displayProtocol в data/base.json5), не замена им.
#
# 'Remote Desktop' — системное имя встроенной группы firewall-правил
# Windows (не наш выбор, не конфиг), поэтому в отличие от openssh
# (там правило создаём мы сами и имя объявлено в data/features/
# openssh.json5) здесь оно захардкожено как есть.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

try {
  Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Type DWord -Value 0 -ErrorAction Stop
  Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction Stop
  Write-ComLog 'enable-rdp-access: OK'
} catch {
  Write-ComLog "enable-rdp-access: FAILED - $($_.Exception.Message)"
}
