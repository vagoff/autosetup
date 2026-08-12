# Модуль: ограниченная по времени попытка Add-WindowsCapability -Online
# для OpenSSH.Server.
#
# Это ЕДИНСТВЕННЫЙ шаг с доказанной историей зависания без таймаута (см.
# историю задачи — 0 операций диска, живой vCPU, прогресс-бар на 0% не
# сдвинулся за час). Поэтому и только поэтому — здесь, а не как общий
# паттерн "на всякий случай" — оборачиваем в Start-Job/Wait-Job.
#
# Цель этого прогона — не "поставить ssh любой ценой", а получить
# окончательное, воспроизводимое подтверждение: зависает ли этот вызов
# именно здесь (LTSC без локального FOD-источника) детерминированно,
# и не заблокировать этим остальные FirstLogonCommands навсегда.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

Write-ComLog 'probe-openssh-capability: start'

$job = Start-Job -ScriptBlock {
  try {
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' -ErrorAction Stop
    'SUCCESS'
  } catch {
    "ERROR: $($_.Exception.Message)"
  }
}

$completed = Wait-Job -Job $job -Timeout {{CAPABILITY_PROBE_TIMEOUT_SECONDS}}

if (-not $completed) {
  Write-ComLog "probe-openssh-capability: TIMEOUT after {{CAPABILITY_PROBE_TIMEOUT_SECONDS}}s - подтверждённое зависание, оставляю job и иду дальше"
  Stop-Job -Job $job -ErrorAction SilentlyContinue
} else {
  $result = Receive-Job -Job $job -ErrorAction SilentlyContinue
  Write-ComLog "probe-openssh-capability: завершился без зависания, result=$result"
}

Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
Write-ComLog 'probe-openssh-capability: end'
