архитектурные решения:

- вся связь — tcp/loopback: QMP 127.0.0.1:4000, COM1(лог)/COM2(команды)
  127.0.0.1:4002/4003, SPICE 127.0.0.1:6900/VNC 127.0.0.1:6901 (точные
  номера — `data/vars.json5`, единственный источник). TPM ctrl-канал —
  ЕДИНСТВЕННОЕ исключение, unix-сокет (qemu передаёт fd через
  CMD_SET_DATAFD/SCM_RIGHTS — существует только у AF_UNIX, обоснование в
  `data/base.json5`).
- экран человеку: SPICE по умолчанию (буфер обмена, ресайз), VNC — альтернатива,
  переключение через `qemu.displayProtocol` в `data/base.json5`. `-display none` +
  `-vga qxl` — никаких локальных GTK/SDL-окон (это служба, не десктоп-процесс).
- диск — SATA/AHCI, не virtio: сознательно, чтобы не тащить virtio-win
  driver ISO на этапе установки.
- сеть гостя — e1000e + SLIRP hostfwd: ssh 2222→22, winrm 5985→5985,
  rdp 3389→3389 (`data/vars.json5`, `qemu.guestPortForwards`).
- конфиг разложен по ролям, не одним файлом: `data/vars.json5` (голые
  пути/порты) + `data/base.json5` (ядро VM, не зависит от выбора фич) +
  `data/features/<id>.json5` (одна опциональная фича — один файл: сейчас
  `winrm`/`openssh`/`serial-agent`/`rdp`) + `data/profiles/<vmName>.json5`
  (какая VM и какой набор фич). `src/configure.js` их собирает в один
  плоский объект прежней формы — потребители (`src/*.js`) этого
  разделения не видят. Выбор профиля — явный (`AUTOSETUP_PROFILE`/
  `--profile`, см. "долг" в `notes.md`), fail-fast при неоднозначности.
- `qemu.bootFromInstaller` — не конфиг, а вычисляемый факт
  (`src/infrastructure/resolve-boot-from-installer.js` по наличию
  `db/<vmName>/install-complete.marker`, который создаёт один раз
  `src/verbs/mark-windows-install-complete.js` по строке "ALL DONE" в
  `com1.log`). Конфиг не мутирует в штатной работе.
- выключение гостя — ACPI `system_powerdown`, не `quit`/kill: через
  process-manager (`a pm stop --name qemu-<vmName>`, лестница
  `qmp-graceful → SIGTERM → SIGKILL`, обычный путь) или напрямую
  (`node src/verbs/orchestrators/shutdown-guest.js`, если VM поднята в обход
  process-manager). Осиротевшие qemu/swtpm при SIGKILL самого
  `run-vm.js` подчищает `src/lib/spawn-orphan-watchdog.js` (детач-процесс,
  переживает родителя по построению).
- VM запускаются как сервисы process-manager (`scripts/services.def`,
  один сервис на профиль намеренно — профиль это часть смысла имени
  сервиса, не параметр запуска). Сейчас общий набор портов на все
  профили (`data/vars.json5`) — значит одновременно может быть поднята
  только одна VM; `qmp-probe` сверяет `query-name`, чтобы вторая VM не
  спутала себя с чужой на общем порту (см. `TODO.md`).
- argv qemu проверен структурно на заглушках файлов + живыми прогонами
  через process-manager (в песочнице агента нет /dev/kvm — это делает
  человек/pm на хосте).
- прикладное состояние 1С объявлено отдельно в `data/1c-configuration.json5`:
  DT, CF и EPF имеют фиксированные SHA-256, файловая база —
  `C:\\1C\\ib\\production-copy`. Три независимо применяемых модуля выполняют
  строго `RestoreIB` без аутентификации (преднамеренно заменяет каталог базы), затем `LoadCfg` +
  `UpdateDBCfg`, затем копирование EPF и создание public shortcut. Они ходят
  к гостю только через уже настроенный SSH, staging проверяют ещё раз на NTFS
  гостя; при ошибке логи 1С и staging сохраняются для диагностики. Тонкий
  `install-1c-infobase.js` после `RestoreIB` создаёт отдельными модульными
  действиями public shortcuts для Enterprise и Designer; EPF shortcut остаётся
  ответственностью EPF-модуля.
- Windows Update выключается одним флагом `data/base.json5` ->
  `windowsUpdate.disable`, который протянут через все этапы жизни VM: Dynamic
  Update в windowsPE, политики реестра через `reg.exe` в specialize (ещё до
  первого входа), остановка и отключение служб гостевым скриптом
  `disable-windows-updates.ps1` на первом входе, подтверждение —
  `check-windows-update-disabled.js`. Один рендерер командной строки
  (`src/infrastructure/build-registry-policy-commands.js`) обслуживает и specialize, и
  guest-скрипт, поэтому таблица значений политик существует ровно в одном
  месте — в конфиге.
- `src/tools/execute-guest-script.js` выполняет объявленный guest-скрипт активного
  профиля на уже работающей VM по SSH, переиспользуя тот же
  `build-first-logon-commands.js`, что собирает USB-образ: на живой диск
  попадает байт в байт то же содержимое, что получила бы свежая установка, и
  второй реализации того же действия не существует.
- Жизненный цикл SSH-сессии и staging-каталога вынесен в
  `src/infrastructure/with-guest-session.js` (`withGuestSession` / `withGuestStaging`):
  staging удаляется только при успехе (при ошибке остаётся для разбора), а
  сессия переживает перезагрузку гостя через мутируемый `session.ssh`.
