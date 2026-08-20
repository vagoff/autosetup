#!/usr/bin/env bash
set -euo pipefail

# разово
sudo pacman -S qemu-desktop edk2-ovmf swtpm qemu-tools qemu-ui-spice-core virt-firmware

# spice client
sudo pacman -S libgovirt
sudo pacman -Sdd virt-viewer spice-gtk phodav
echo do  remote-viewer spice://localhost:6900

cd /data/wd/aibox/autosetup

node src/download-windows-iso.js                # разово, ~5.1GB
node src/create-vm-resources.js                 # разово: диск + OVMF vars + tpm dir
node src/run-vm.js                               # каждый раз для запуска VM (сам определяет boot с CD или с диска)

# после ПЕРВОГО успешного входа гостя (например когда впервые прошёл
# node src/check-ssh-access.js) — один раз зафиксировать, что install
# завершён, иначе run-vm.js при следующем запуске снова полезет
# устанавливать с CD:
#   node src/mark-windows-install-complete.js
#
# полный сброс VM для переустановки с нуля (диск/OVMF vars/tpm/ssh-key/
# install-маркер/com1.log — всё сразу, один оркестратор):
#   node src/destroy-vm-resources.js

echo "${0}: DONE"
exit 0
