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
  (какая VM и какой набор фич). `src/config.js` их собирает в один
  плоский объект прежней формы — потребители (`src/*.js`) этого
  разделения не видят. Выбор профиля — явный (`AUTOSETUP_PROFILE`/
  `--profile`, см. "долг" в `notes.md`), fail-fast при неоднозначности.
- `qemu.bootFromInstaller` — не конфиг, а вычисляемый факт
  (`src/lib/resolve-boot-from-installer.js` по наличию
  `db/<vmName>/install-complete.marker`, который создаёт один раз
  `src/mark-windows-install-complete.js` по строке "ALL DONE" в
  `com1.log`). Конфиг не мутирует в штатной работе.
- выключение гостя — ACPI `system_powerdown`, не `quit`/kill: через
  process-manager (`a pm stop --name qemu-<vmName>`, лестница
  `qmp-graceful → SIGTERM → SIGKILL`, обычный путь) или напрямую
  (`node src/shutdown-guest.js`, если VM поднята в обход
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
