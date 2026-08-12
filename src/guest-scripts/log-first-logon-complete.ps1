# Модуль: финальный маркер — если эта строка появилась в com1.log, значит
# вся цепочка FirstLogonCommands дошла до конца, ни один шаг не заблокировал
# остальные навсегда (в частности — таймаут в probe-openssh-capability
# сработал так, как задуман).
. "$PSScriptRoot\_lib-guest-script-prelude.ps1"

Write-ComLog 'first-logon-commands: ALL DONE'
