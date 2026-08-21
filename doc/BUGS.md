# известные дефекты

Область действия: проект `/data/wd/aibox/autosetup`. Только воспроизводимые дефекты в коде
этого проекта -- отложенные работы и замыслы в `TODO.md`, сознательно принятые компромиссы
в `deferred-todo.md`, инварианты в `INVARIANTS.md`.


---

stageSourceTree and stageGuestFiles -- code dup?

---

stageGuestFiles засирает папку назначения, не убирая за собой никогда

---

## закрыто: SSH намертво зависал на handshake после суток работы VM

Симптом: `check-ssh-access.js` -> `Timed out while waiting for handshake`; на хосте
`ss` показывает CLOSE-WAIT на 127.0.0.1:2222 с непрочитанным Recv-Q, в госте
`sc query sshd` = RUNNING и `netstat` = LISTENING 0.0.0.0:22, в OpenSSH/Operational
нет ни одной записи о новых попытках -- то есть SYN до sshd не доходил вообще.

Причина (цепочка, подтверждена в живой VM):

1. `probe-openssh-capability-with-timeout.ps1` на первом входе запускал
   `Add-WindowsCapability -Online -Name OpenSSH.Server` и по таймауту 90с бросал
   job. Отменить уже начатое обслуживание это не может: фича осталась в состоянии
   `InstallPending` (проверено `Get-WindowsCapability -Online`).
2. Гость через SLIRP имеет полноценный выход в интернет, Windows Update включён;
   очередной проход обслуживания (`UpdateAgentLCU`, KB5120710, Setup-лог 8/21 08:20)
   продолжил отложенную установку inbox-фичи OpenSSH.Server.
3. Установка/удаление этой фичи (а) трогает регистрацию службы с тем же именем
   `sshd` -- отсюда `sc start sshd` -> 1060, и (б) пересоздаёт firewall-правило с
   именем `OpenSSH-Server-In-TCP`.
4. `data/features/openssh.json5` объявляло ровно это, майкрософтовское, имя правила,
   а `install-openssh-access.ps1` не создавало своё правило, а "усыновляло" чужое.
   Пересозданное Windows правило имеет program-фильтр на
   `C:\Windows\System32\OpenSSH\sshd.exe`, тогда как наш sshd -- это
   `C:\Program Files\OpenSSH-Win64\sshd.exe`. Входящий :22 стал молча
   дропаться firewall'ом; SLIRP при этом висит на недоставленном SYN, чем и
   объясняются и "зависший handshake", и CLOSE-WAIT на хосте (listen backlog у
   hostfwd = 1).

Доказательство: временное правило `allow tcp/22 any program` в госте немедленно
вернуло `SSH login: OK`, после его удаления и создания правила под собственным
именем SSH остался рабочим.

Исправлено:

- `data/features/openssh.json5`: `firewallRuleName: 'AutoSetup-OpenSSH-In'` --
  собственное пространство имён, как уже сделано у Apache
  (`AutoSetup-Apache-HTTP-In`); Windows больше не владеет нашим правилом.
- `install-openssh-access.ps1`: правило создаётся целиком нами
  (`Remove-NetFirewallRule` + `New-NetFirewallRule`), без program-фильтра, вместо
  правки чужого.
- `probe-openssh-capability-with-timeout.ps1` удалён вместе с
  `capabilityProbeTimeoutSeconds`: диагностический шаг, который необратимо мутирует
  гостя (начинает установку FoD и бросает её), не имеет права находиться в
  provisioning-цепочке -- свой ответ он уже дал.

Профилактика того же класса отказов: Windows Update теперь выключается одним флагом
`data/base.json5` -> `windowsUpdate.disable` (см. architecture.md), то есть проходов
обслуживания, способных переписать наши службы и правила, больше не происходит.

Живая VM починена теми же средствами: `Remove-WindowsCapability` +
перезагрузка (сняла `InstallPending`; попутно снесла регистрацию службы `sshd` --
ещё одно прямое подтверждение механизма), повторный `install-sshd.ps1`,
правило `AutoSetup-OpenSSH-In`. `check-ssh-access.js` и
`check-1c-platform-installation.js` проходят.

## открыто: check-winrm-access.js -> NTLM authentication failed: 401

Воспроизводится на живой VM: служба WinRM Running, `LocalAccountTokenFilterPolicy=1`,
`winrm/config/service/auth` содержит Negotiate=true, в Security-логе гостя нет ни
одного 4625 -- то есть отказ происходит до проверки учётной записи. SSH тем же
паролем/учёткой работает. Не связано с инцидентом выше (состояние WinRM переживает
перезагрузку без изменений); нужен отдельный разбор со стороны клиента
(`src/lib/run-winrm-powershell.js`).
