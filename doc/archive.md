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

