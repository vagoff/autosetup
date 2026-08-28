# Модуль: детерминированно выключить Windows Update в госте.
#
# Зачем это вообще есть: гость имеет выход в интернет, и Windows Update по
# собственной инициативе меняет состояние уже развёрнутой машины. Это не
# теоретический риск -- проход обслуживания однажды доломал SSH (см.
# doc/BUGS.md), а для цели проекта "100% воспроизводимое окружение" любое
# самовольное изменение состояния означает, что две одинаковые сборки дают
# разные машины.
#
# Тот же набор политик применяется ещё раньше, в specialize-проходе Windows
# Setup (autounattend.xml), тем же reg.exe и из того же объявления в
# data/base.json5. Здесь -- то, чего в specialize сделать нельзя: остановка
# и отключение самих служб.
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

$policyArgumentLines = @(
{{WINDOWS_UPDATE_POLICY_ARGUMENT_LINES_PS_ARRAY}}
)
$serviceNames = @({{WINDOWS_UPDATE_SERVICE_NAMES_PS_ARRAY}})
$scheduledTaskPaths = @({{WINDOWS_UPDATE_SCHEDULED_TASK_PATHS_PS_ARRAY}})

Write-ComLog 'disable-windows-updates: start'

try {
  foreach ($argumentLine in $policyArgumentLines) {
    $process = Start-Process -FilePath "$env:SystemRoot\System32\reg.exe" -ArgumentList $argumentLine -Wait -PassThru -WindowStyle Hidden
    if ([int]$process.ExitCode -ne 0) {
      throw "reg.exe $argumentLine exited with $([int]$process.ExitCode)"
    }
  }

  foreach ($serviceName in $serviceNames) {
    # Отсутствие объявленной службы -- ошибка, а не повод молча пойти
    # дальше: иначе опечатка в конфиге навсегда останется незамеченной, а
    # обновления -- включёнными.
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force -ErrorAction Stop }
    Set-Service -Name $serviceName -StartupType Disabled -ErrorAction Stop
  }

  # Задачи планировщика гасим ПЕРЕД службами: иначе задача успевает поднять
  # службу обратно между нашими двумя шагами. Часть задач принадлежит
  # TrustedInstaller и не поддаётся даже администратору -- такие считаем и
  # сообщаем, но не валим весь скрипт: службы и политики от этого не страдают.
  $disabledTasks = 0
  $refusedTasks = 0
  foreach ($taskPath in $scheduledTaskPaths) {
    foreach ($task in @(Get-ScheduledTask -TaskPath $taskPath -ErrorAction SilentlyContinue)) {
      if ($task.State -eq 'Disabled') { continue }
      try {
        Disable-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName -ErrorAction Stop | Out-Null
        $disabledTasks++
      } catch {
        $refusedTasks++
      }
    }
  }

  Write-ComLog "disable-windows-updates: OK tasks-disabled=$disabledTasks tasks-refused=$refusedTasks"
} catch {
  Write-ComLog "disable-windows-updates: FAILED - $($_.Exception.Message)"
  throw
}
