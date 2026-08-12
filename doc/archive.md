сделано, лежит в `src/` (+ `data/config.json5`):
- `config.js` — тонкий loader единственного источника констант `data/config.json5` (JSON5).
- `download-windows-iso.js`, `create-disk-image.js`, `provision-ovmf-vars.js`,
  `create-tpm-state-dir.js` — одноразовые create-скрипты, каждый fail-fast
  если цель уже существует (см. "известные пробелы" про STATEFUL-RESOURCE-GUARD).
- `create-vm-resources.js` — тонкий оркестратор, вызывает 3 create-скрипта выше.
- `spawn-swtpm-process.js`, `spawn-qemu-process.js` — запуск долгоживущих
  процессов, оба с обработкой `error`-события процесса (чистый fail-fast,
  не сырой node-стектрейс).
- `run-vm.js` — тонкий оркестратор запуска: swtpm → дождаться tcp-порта → qemu → связать shutdown обоих.


известные пробелы (обсуждались, решения не доведены до кода):
- QMP-порт открыт, но само управление (screendump/sendkey для будущей
  unattended-установки через autounattend.xml) не реализовано.
- unattended install (autounattend.xml) не начат — install предполагается
  первый раз ручной, через SPICE/VNC.
- enable-rdp.ps1 (и вообще любые PowerShell/OneScript скрипты для гостя) не написаны.
- принцип "create-скрипты для stateful-ресурсов (диск/OVMF vars/tpm state)
  обязаны fail-fast, а не молча пропускать/перезаписывать" — применён в коде,
  но не вписан отдельным пунктом в "как нужно сделать".


## Разобрался, что именно висит

Снял скриншот с живой (не убитой) VM и сравнил с `query-blockstats`(6с, дельта
0 по всем устройствам, при этом `query-status.running: true` и часы в трее
идут) — то есть vCPU не спит, диск полностью не трогается. Экран
подтверждает: открыт `Administrator: Windows PowerShell`, идёт
`Add-WindowsCapability`, прогресс-бар **`Operation Running
[oooo...]` заморожен на 0%**. Это не "медленно устанавливается" — это
классическая сигнатура блокирующего сетевого вызова без таймаута (диск бы
шевелился при реальной распаковке пакета, сеть — нет).

**Корневая причина, с высокой уверенностью:** в `config.json5` образ —
  `..._CLIENT_LTSC_EVAL_...iso`, то есть **Windows 11 Enterprise LTSC**.
  Microsoft намеренно не даёт LTSC-редакциям Features-on-Demand через Windows
  Update — `Add-WindowsCapability -Online` на LTSC без локального
  FOD-источника не может найти пакет, и на практике это часто не падает с
  внятной ошибкой, а виснет намертво в ожидании ответа от источника, которого
  architecturally нет. Это объясняет и "0 операций диска", и "не помогает
  Ctrl+C" (WU-клиент внутри слушает событие/сокет, не консоль).


`status: running`, но зависшую на шаге `Add-WindowsCapability` (Ctrl+C не помог, диск всё ещё 0 операций).

- **Полный цикл от чистого состояния до экрана установщика** — `destroy-vm-resources.js → create-vm-resources.js → run-vm.js`, включая swtpm (unix-сокет), автопрохождение CD-boot prompt — воспроизводимо, провере
но дважды.
- **Secure Boot — была причина блокировки "doesn't meet system requirements"**. Две находки:
  1. `OVMF_CODE.4m.fd` (был первым кандидатом в конфиге) вообще не собран с поддержкой Secure Boot — нужен `OVMF_CODE.secboot.4m.fd` (есть в пакете `edk2-ovmf 202605-1` на этом obarun).
  2. Свежий `OVMF_VARS.4m.fd` — **совсем пустой** (0 переменных, проверено `virt-fw-vars --print --verbose`), ни ключей, ни состояния.
  Фикс: новый `src/enroll-secure-boot-keys.js`, вызывается из `create-vm-resources.js` сразу после `provisionOvmfVars()`, гоняет `virt-fw-vars --inplace <db/.../OVMF_VARS.fd> --enroll-microsoft --secure-boot` —
только на **нашу** per-VM копию в `db/`, хостовый `/usr/share/edk2/...` не трогается. Требует `pip install --user virt-firmware` на obarun (уже поставлено).
  После фикса: прошли блокировку, дошли до реальной установки, партиционирование по unattend отработало, дошли до 94%, потом до рабочего стола с автологином.
- **Unattended install через `autounattend.xml`** работает: язык/диск/учётка/автологин — всё как задумано. Файл доставляется отдельной USB-флешкой (не тот же носитель что ISO), собирается `src/build-answer-file-
image.js` через **`libmount`** (выбрали его после сравнения с `mtools`/`fatfs`/`fatfs-wasm`/самопальным FAT12 — играет роль, что `autounattend.xml` требует LFN, это не тривиально).

## Текущая проблема — на чём споткнулись

`FirstLogonCommands` (в `data/config.json5` → `unattend.firstLogonCommands`), шаг 2:
```
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```
**Зависает намертво** — не "медленно", а именно zero-progress: `query-blockstats` на `disk0` показывает 0 операций чтения/записи за 8+ секунд (несколько проверок подряд), часы гостя не двигались 10+ минут, `Ctrl
+C` через QMP `send-key` не помог. Похоже на блокирующий сетевой вызов к Windows Update без таймаута (DISM online source), которого либо нет, либо он недостижим из гостя.

## Рекомендация на следующий заход

1. **Убрать или переделать шаг с OpenSSH** в `unattend.firstLogonCommands`:
   - Проще всего — просто выкинуть (WinRM из шага 1, `Enable-PSRemoting -Force`, уже закрывает требование "слать PowerShell-скрипты в Windows" из вводных; ssh был бонусом).
   - Если ssh всё же нужен — оборачивать в `Start-Job` + `Wait-Job -Timeout N`, чтобы зависание не блокировало всю цепочку FirstLogonCommands намертво.
2. **Проверить WinRM отдельно от ssh** — шаг 1 (`Enable-PSRemoting`) успел отработать до того, как всё повисло на шаге 2, но порт 5985 так и не появился за это время. Возможная причина — Windows классифицирует S
LIRP-сеть как "Public", а `Enable-PSRemoting -Force` без `-SkipNetworkProfileCheck` не открывает файрвол на Public-профиле. Стоит добавить этот флаг превентивно.
3. Полный цикл переустановки — это ~10-12 минут реального времени до рабочего стола, так что лучше батчить фиксы перед следующим прогоном, а не по одному.
4. Диагностика зависаний через `query-blockstats` (дельта операций за несколько секунд = точный признак живости гостя, без экрана/OCR) — оказалась рабочим паттерном, возможно стоит оформить отдельным переиспольз
уемым хелпером, если зависания будут повторяться.

