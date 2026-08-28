памятка:
- у alpine и obarun общее сетевое пространство, никаких "портов" никуда "пробрасывать" не нужно.
- Node ≥22 используется ради встроенного `zlib.crc32` в `ppm-to-png.js` (там же — самодельный PNG-энкодер без зависимостей).

инструменты для агента (в `scripts/`, не для человека):
- `scripts/run-qmp-command.js <command> [argsJSON]` — разовая произвольная QMP-команда
  (query-status, query-block, query-blockstats, quit, send-key, ...) поверх уже
  существующего `src/infrastructure/connect-qmp.js`, JSON-ответ в stdout. Завёлся вместо
  повторяющихся одноразовых `node -e "..."` в ручной диагностике по QMP.
  Пример: `node scripts/run-qmp-command.js query-status`.
- `scripts/shutdown.sh` — только для человека на хосте: убивает qemu по
  `qemu.pidFile` и подтверждает смерть процесса. Из sandboxed-контейнера агента
  НЕ РАБОТАЕТ для реального qemu — PID-namespace не расшарен с хостом (расшарена
  только сеть), поэтому `process.kill(pid, 0)` внутри контейнера всегда "никого
  не находит", даже если на хосте процесс жив.

  [УСТАРЕЛО] Раньше здесь было сказано, что агенту для остановки VM — только QMP
  `quit` по сети. Это неверно и опасно: `quit` — жёсткий останов, для гостя
  эквивалент выдернутой вилки (то же самое, чего мы избегаем через
  `scripts/shutdown.sh`/жёсткий kill, просто с другой стороны). Актуально:
  - если VM поднята через process-manager (обычный случай, см.
    `scripts/services.def`) — `a pm stop --name qemu-win11-1c` (или
    `-rdp`): лестница `qmp-graceful → SIGTERM → SIGKILL`, ACPI-путь пробует
    выключить гостя штатно первым, подробности —
    `/data/wd/aibox/dev-env/tools/process-manager/doc/PROBES.md`.
  - если VM поднята напрямую (`node src/services/run-vm.js`, в обход process-manager) —
    `node src/verbs/orchestrators/shutdown-guest.js`: тот же принцип (ACPI `system_powerdown` +
    сетевое ожидание, без PID), самостоятельный скрипт на этот случай.
  - `scripts/run-qmp-command.js` остаётся тем, чем и был — разовый CLI для
    произвольных QMP-команд (`query-status`, `screendump`, `send-key`, ...),
    не единственным способом остановки VM.


## долг: профиль передаётся через переменную окружения

`src/configure.js` -- синглтон: он читает `data/`, выбирает профиль и валидирует его **в момент
импорта**, а выбор берёт из `process.env.AUTOSETUP_PROFILE`. Все `src/*.js` импортируют уже
готовый объект, поэтому передать выбор аргументом сегодня нельзя ни из чего.

`src/services/run-vm-cli.js` -- временный мост: он разбирает `--profile <имя>` штатным `cli_main`
(`libs/json-args`), резолвит имя в путь (с проверкой существования и списком доступных имён в
ошибке) и пишет `AUTOSETUP_PROFILE` **до** динамического импорта `run-vm.js`. Это передача
аргумента через глобальную переменную процесса, то есть нарушение -- см `[!]`-комментарии в
шапке файла.

Как правильно: `configure.js` становится `load_config({profile_path})`, значение течёт вниз
аргументом, `run-vm.js` получает сигнатуру `runVm({config})`, переменная окружения исчезает
совсем. До тех пор `run-vm-cli.js` -- единственное место во всей системе, где
`AUTOSETUP_PROFILE` пишется, и второй такой переменной заводить нельзя.

Сервисы в `scripts/services.def` объявлены по одному на профиль (`qemu-win11-1c`,
`qemu-win11-1c-rdp`) -- сервис process-manager'а это определение, а не шаблон, и профиль
входит в смысл имени. `min_uptime_sec = 3` там стоит потому, что профиль плагинов `bare`
ничего не доказывает; правильная замена -- проба по QMP-сокету или serial-логу.

## Установка 1С и Apache поверх готовой Windows

Платформа 1С не является FirstLogon-фичей. Её надо уметь применить к уже
работающему гостю после экспериментов, поэтому модули из `src/` подключаются
к гостю по уже проверенному SSH и передают дистрибутив по SFTP. Это сознательно
требует профиль с `openssh`; COM2 не используется для доставки сотен мегабайт.

Конфигурация и закреплённые байты находятся в отдельных файлах:

- `data/1c-platform.json5` — 1С 8.3.19.1529, русский transform и полный
  MSI-набор `ADDLOCAL=ALL`;
- `data/apache-httpd.json5` — Apache Lounge 2.4.68 Win64 VS18, URL, размер и
  SHA-256, а также обязательный Microsoft Visual C++ Redistributable
  14.51.36247 с отдельным URL/размером/SHA-256; оба архива хранятся локально
  в игнорируемом `vendor/apache/` и воспроизводимо загружаются отдельными
  download-модулями;
- `data/vars.json5` — единственный порт публикаций: guest `80` → host
  loopback `8080`.

Перед установкой `check-1c-platform-distribution.js` и
`check-apache-httpd-distribution.js` проверяют размер и SHA-256 локальных
файлов. После SFTP тот же манифест проверяется ещё раз на NTFS гостя в
уникальном временном каталоге. MSI получает только полностью проверенные
файлы; MSI-лог остаётся в `C:\ProgramData\AutoSetup\logs`.

Apache Lounge VS18 не запускается с VC++ 2015, который лежит в поставке 1С:
`httpd.exe` завершается `0xC0000135` до чтения конфига. Поэтому
`install-apache-httpd.js` прежде Apache устанавливает закреплённый VC++ runtime
и принимает только коды `0`, `1638` (уже установлена та же или новая версия) и
`3010` (запрошена перезагрузка). Для `3010` применяется тот же детерминированный
restart по изменению boot time, затем staging собирается заново.

Обычная последовательность для выбранного профиля:

```text
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/verbs/install-1c-platform.js
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/verbs/install-apache-httpd.js
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/verbs/configure-1c-apache-web-extension.js
```

`install-1c-web-environment.js` — только тонкий оркестратор этих трёх
действий. Модули идемпотентны: совпадающая установленная версия 1С или Apache
не ставится второй раз; другой Apache в целевом каталоге — явная ошибка, а не
перезапись. Код MSI `3010` вызывает перезагрузку и ожидается не по времени, а
по изменению `Win32_OperatingSystem.LastBootUpTime` с ограничивающим deadline.

`configure-1c-apache-web-extension.js` регистрирует `wsap24.dll`, затем
проверяет конфиг командой `httpd.exe -t` и HTTP-ответ через `127.0.0.1:8080`.
Это делает Apache готовым к публикации, но намеренно НЕ публикует неизвестную
пока инфобазу и не включает OData: отдельный будущий модуль будет создавать
`default.vrd` для конкретной восстановленной базы и только тогда включит
стандартный интерфейс OData.

`vendor/1C/UPDATE/techsys.dll` — внешняя замена штатной DLL, не часть
дистрибутива платформы, поэтому не входит в `install-1c-web-environment.js`.
Её отдельный, явно вызываемый модуль:

```text
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/verbs/install-1c-techsys-update.js
```

Конфиг `data/1c-techsys-update.json5` закрепляет хеши обновлённой DLL и
исходной DLL конкретной BAF 8.3.19.1529. Перед заменой модуль находит и
останавливает только службы, чья `PathName` указывает в каталог данной
платформы, затем отказывается продолжать при любом оставшемся процессе 1С.
Оригинал копируется в `bin/techsys_5.dll` и оба хеша перепроверяются; при
сбое финальной проверки оригинал восстанавливается. Остановленные модулем
службы запускаются обратно и при ошибке. Повторный запуск допустим только при
наличии проверенной резервной копии и становится no-op.

## Маркер завершения Windows создаётся автоматически

`first-logon-commands: ALL DONE` в COM1 — уже достаточное доказательство,
что Windows и все FirstLogonCommands установлены. Раньше после этого нужно
было вручную запускать `mark-windows-install-complete.js`; без созданного
`db/<vmName>/install-complete.marker` следующий `run-vm` видел непустой
`com1.log`, принимал готовую VM за оборванную установку и по правилам
`restart-install-if-interrupted.js` пересоздавал диск/OVMF/TPM.

Теперь `run-vm.js` во время первичной установки запускает
`wait-for-windows-install-complete.js`. Тот подписывается на файловые события
durable COM1-лога и после появления конфигурируемой строки
`unattend.firstLogonCompletionLogLine` вызывает единственный create-модуль
`mark-windows-install-complete.js`. Нет ни фиксированной задержки, ни второго
источника текста сигнала: guest-скрипт, watcher и marker берут одну строку из
`data/base.json5`.

---

doc/1c-demo-requirements.md ссылается на несуществующее сейчас разделение прав по операциям (create/update/delete) для OData в самом протоколе — платформа этого не даёт, я это явно задокументировал как ограничение, а не спрятал.

## История завершений Windows

```text
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/tools/read-guest-shutdown-history.js
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/tools/read-guest-shutdown-history.js --limit 50
```

`read-guest-shutdown-history.js` только читает `System` Event Log гостя. Он
сопоставляет `USER32/1074`, `Kernel-General/13`, `EventLog/6006`,
`Kernel-General/12`, `Kernel-Power/41` и `EventLog/6008` между загрузками.
`shutdown-request-recorded-clean` означает, что Windows зарегистрировала
запрос и дошла до `6006` (остановка службы Event Log, доказательство чистого
пути, но не точная последняя инструкция выключения ОС);
`shutdown-request-recorded-unclean` — что запрос был, но следующая загрузка
зафиксировала нештатный конец. Сам Windows-журнал не
может доказать, что запрос пришёл именно от QMP ACPI, и не различает отключение
питания от падения гостя: это намеренно остаётся в названиях статусов и raw
evidence, а не скрывается под ложной точностью.
