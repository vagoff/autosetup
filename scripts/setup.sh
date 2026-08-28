#!/usr/bin/env bash
set -euo pipefail

# разово
sudo pacman -S qemu-desktop edk2-ovmf swtpm qemu-tools qemu-ui-spice-core virt-firmware

# spice client
sudo pacman -S libgovirt
sudo pacman -Sdd virt-viewer spice-gtk phodav
echo do  remote-viewer spice://localhost:6900

echo "${0}: DONE"
exit 0
