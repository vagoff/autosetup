import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolveExistingPath } from './lib/resolve-existing-path.js';

// Флаги показа экрана человеку — протокол выбирается конфигом
// (qemu.displayProtocol), а не хардкодится. И spice, и vnc — tcp/loopback.
function buildDisplayTransportArgs(qemu) {
  if (qemu.displayProtocol === 'spice') {
    return ['-spice', `port=${qemu.spicePort},addr=127.0.0.1,disable-ticketing=on`];
  }
  if (qemu.displayProtocol === 'vnc') {
    return ['-vnc', `127.0.0.1:${qemu.vncPort - 5900}`];
  }
  throw new Error(`неизвестный qemu.displayProtocol в конфиге: ${qemu.displayProtocol}`);
}

// Строит argv для qemu-system-x86_64 целиком из config.js — ни одной
// константы вне единого источника (CONFIG-SINGLE-SOURCE).
export function buildQemuArgs() {
  const { disk, ovmf, qemu, windowsIso, paths, tpm } = config;

  if (!existsSync(disk.path)) {
    throw new Error(`нет диска: ${disk.path}. Сначала запусти create-vm-resources.js`);
  }
  if (!existsSync(ovmf.varsPath)) {
    throw new Error(`нет OVMF vars: ${ovmf.varsPath}. Сначала запусти create-vm-resources.js`);
  }
  const ovmfCode = resolveExistingPath(ovmf.codeTemplateCandidates, 'OVMF code');
  const isoPath = path.join(paths.isoDir, windowsIso.filename);
  if (!existsSync(isoPath)) {
    throw new Error(`нет Windows ISO: ${isoPath}. Сначала запусти download-windows-iso.js`);
  }

  // проброс портов ИЗ ГОСТЯ через SLIRP NAT — отдельная сущность от общего
  // сетевого пространства alpine/obarun, гость всегда за NAT самого qemu.
  const hostfwd = qemu.guestPortForwards
    .map((f) => `,hostfwd=${f.proto}::${f.hostPort}-:${f.guestPort}`)
    .join('');

  return [
    '-name', qemu.vmName,
    '-machine', `${qemu.machine},accel=${qemu.accel}`,
    '-cpu', qemu.cpu,
    '-smp', String(qemu.smp),
    '-m', String(qemu.ramMiB),
    '-drive', `if=pflash,format=raw,readonly=on,file=${ovmfCode}`,
    '-drive', `if=pflash,format=raw,file=${ovmf.varsPath}`,
    '-device', 'ahci,id=ahci0',
    '-drive', `if=none,id=disk0,file=${disk.path},format=${disk.format}`,
    '-device', 'ide-hd,bus=ahci0.0,drive=disk0',
    '-drive', `if=none,id=cdrom0,media=cdrom,file=${isoPath},readonly=on`,
    '-device', 'ide-cd,bus=ahci0.1,drive=cdrom0',
    '-boot', `order=${qemu.bootFromInstaller ? 'dc' : 'cd'}`,
    '-netdev', `user,id=net0${hostfwd}`,
    '-device', `${qemu.netDevice},netdev=net0`,
    // TPM: control-канал у swtpm поднят на tcp/loopback, qemu подключается
    // клиентом (swtpm уже слушает к этому моменту — run-vm.js гарантирует
    // порядок запуска).
    '-chardev', `socket,id=chrtpm,host=127.0.0.1,port=${tpm.ctrlPort}`,
    '-tpmdev', 'emulator,id=tpm0,chardev=chrtpm',
    '-device', 'tpm-tis,tpmdev=tpm0',
    '-device', 'qemu-xhci,id=usb0',
    '-device', 'usb-tablet,bus=usb0.0',
    '-vga', 'qxl',
    '-display', 'none', // никаких локальных GTK/SDL-окон — это служба
    ...buildDisplayTransportArgs(qemu),
    // QMP — управление скриптом/агентом (screendump, sendkey, powerdown).
    '-qmp', `tcp:127.0.0.1:${qemu.qmpPort},server,nowait`,
    '-rtc', 'base=localtime',
    '-pidfile', qemu.pidFile,
  ];
}

export function spawnQemuProcess() {
  const child = spawn(config.qemu.binary, buildQemuArgs(), { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`не смог запустить ${config.qemu.binary}: ${error.message}`);
    process.exit(1);
  });
  return child;
}
