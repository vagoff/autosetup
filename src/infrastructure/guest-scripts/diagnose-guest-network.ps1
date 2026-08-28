# Модуль: измерить, а не предположить, есть ли у гостя рабочий сетевой
# путь наружу — профиль подключения (NLA-категория) + DNS/TCP-достижимость
# конкретных целей из base.json5 (diagnostics.networkProbeTargets).
#
# Сами TCP-пробы завёрнуты в Start-Job/Wait-Job с явным верхним пределом
# (diagnostics.networkProbeTimeoutSeconds): не полагаемся на то, что
# у Test-NetConnection где-то внутри есть разумный дефолтный таймаут,
# проверяем это утверждение сами.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

Write-ComLog 'diagnose-guest-network: start'

try {
  $profiles = Get-NetConnectionProfile -ErrorAction Stop
  foreach ($p in $profiles) {
    Write-ComLog "network-profile: $($p.InterfaceAlias) category=$($p.NetworkCategory) ipv4=$($p.IPv4Connectivity) ipv6=$($p.IPv6Connectivity)"
  }
} catch {
  Write-ComLog "network-profile: FAILED - $($_.Exception.Message)"
}

$targets = @(
{{NETWORK_PROBE_TARGETS_PS_ARRAY}}
)

$job = Start-Job -ScriptBlock {
  param($targets)
  foreach ($target in $targets) {
    $row = [ordered]@{ Label = $target.Label; Host = $target.Host; Port = $target.Port; Succeeded = $false; ResolvedAddress = $null; Error = $null }
    try {
      $result = Test-NetConnection -ComputerName $target.Host -Port $target.Port -WarningAction SilentlyContinue
      $row.Succeeded = $result.TcpTestSucceeded
      $row.ResolvedAddress = "$($result.RemoteAddress)"
    } catch {
      $row.Error = $_.Exception.Message
    }
    [pscustomobject]$row
  }
} -ArgumentList (,$targets)

$completed = Wait-Job -Job $job -Timeout {{NETWORK_PROBE_TIMEOUT_SECONDS}}
if (-not $completed) {
  Write-ComLog "diagnose-guest-network: TIMEOUT after {{NETWORK_PROBE_TIMEOUT_SECONDS}}s - probes did not finish"
  Stop-Job -Job $job -ErrorAction SilentlyContinue
} else {
  $rows = Receive-Job -Job $job -ErrorAction SilentlyContinue
  foreach ($row in $rows) {
    if ($row.Error) {
      Write-ComLog "probe $($row.Label) ($($row.Host):$($row.Port)): ERROR - $($row.Error)"
    } else {
      Write-ComLog "probe $($row.Label) ($($row.Host):$($row.Port)): TcpTestSucceeded=$($row.Succeeded) ResolvedAddress=$($row.ResolvedAddress)"
    }
  }
}
Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

Write-ComLog 'diagnose-guest-network: done'
