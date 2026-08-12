#!/usr/bin/env bash
set -euo pipefail

# разово
sudo pacman -S qemu-desktop edk2-ovmf swtpm qemu-tools qemu-ui-spice-core

cd /data/wd/aibox/wintest

node src/download-windows-iso.js                # разово, ~5.1GB
node src/create-vm-resources.js                 # разово: диск + OVMF vars + tpm dir
node src/run-vm.js                               # каждый раз для запуска VM

echo "${0}: DONE"
exit 0
