# Модуль: финальный маркер — если эта строка появилась в потоке COM1
# (durable-копия — cache/<vm>/com1.log, см. capture-serial-log.js), значит
# вся цепочка FirstLogonCommands дошла до конца, ни один шаг не заблокировал
# остальные навсегда (в частности — таймаут в probe-openssh-capability
# сработал так, как задуман).
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

Write-ComLog '{{FIRST_LOGON_COMPLETION_LOG_LINE}}'
