ресурсы и материалы:
- Windows 11 Enterprise LTSC 2024 Evaluation `https://software-static.download.prss.microsoft.com/dbazure/888969d5-f34g-4e03-ac9d-1f9786c66749/26100.1742.240906-0331.ge_release_svc_refresh_CLIENT_LTSC_EVAL_x64FRE_en-us.iso`

комментарий GPT по поводу образа windows:
```
нормально запускается под QEMU/KVM. Для официально поддерживаемой установки Windows 11 LTSC нужны:

-enable-kvm -cpu host
UEFI/OVMF
виртуальный TPM 2.0 через swtpm
хотя бы 4 ГБ RAM
диск лучше VirtIO, но тогда при установке потребуется ISO с драйверами virtio-win.

Windows 11 официально требует UEFI с поддержкой Secure Boot и TPM 2.0.
Проще всего создать VM через virt-manager: выбрать Windows 11, прошивку UEFI и добавить устройство TPM 2.0 — он сформирует нужный QEMU-запуск сам.

Без TPM тоже ставится обходом проверки, но смысла нет: swtpm лёгкий, официальный evaluation-образ с ним устанавливается штатно.
Для недели экспериментов: 4 ГБ RAM, 2–4 CPU, qcow2 40 ГБ.
```
