import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolveExistingPath } from './lib/resolve-existing-path.js';

// Флаги показа экрана человеку — протокол выбирается конфигом
// (qemu.displayProtocol), а не хардкодится. И spice, и vnc — tcp/loopback.
function buildDisplayTransportArgs(qemu, loopbackHost) {
  if (qemu.displayProtocol === 'spice') {
    return ['-spice', `port=${qemu.spicePort},addr=${loopbackHost},disable-ticketing=on`];
  }
  if (qemu.displayProtocol === 'vnc') {
    return ['-vnc', `${loopbackHost}:${qemu.vncPort - 5900}`];
  }
  throw new Error(`неизвестный qemu.displayProtocol в конфиге: ${qemu.displayProtocol}`);
}

// Строит argv для qemu-system-x86_64 целиком из config.js — ни одной
// константы вне единого источника (CONFIG-SINGLE-SOURCE).
export function buildQemuArgs() {
  const { disk, ovmf, qemu, windowsIso, paths, tpm, network, unattend } = config;

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
  if (qemu.bootFromInstaller && !existsSync(unattend.answerFileImagePath)) {
    throw new Error(`нет образа файла ответов: ${unattend.answerFileImagePath}. Сначала запусти build-answer-file-image.js`);
  }

  // проброс портов ИЗ ГОСТЯ через SLIRP NAT — отдельная сущность от общего
  // сетевого пространства alpine/obarun, гость всегда за NAT самого qemu.
  const hostfwd = qemu.guestPortForwards
    .map((f) => `,hostfwd=${f.proto}:${network.loopbackHost}:${f.hostPort}-:${f.guestPort}`)
    .join('');

  // hv_* — Hyper-V enlightenment флаги, см. комментарий у
  // qemu.cpuHyperVEnlightenments в data/config.json5 (почему они нужны).
  const cpuModel = [qemu.cpu, ...qemu.cpuHyperVEnlightenments].join(',');

  return [
    '-name', qemu.vmName,
    '-machine', `${qemu.machine},accel=${qemu.accel}`,
    '-cpu', cpuModel,
    '-smp', String(qemu.smp),
    '-m', String(qemu.ramMiB),
    '-drive', `if=pflash,format=raw,readonly=on,file=${ovmfCode}`,
    '-drive', `if=pflash,format=raw,file=${ovmf.varsPath}`,
    '-device', 'ahci,id=ahci0',
    '-drive', `if=none,id=disk0,file=${disk.path},format=${disk.format}`,
    '-device', 'ide-hd,bus=ahci0.0,drive=disk0',
    '-drive', `if=none,id=${qemu.cdromDeviceId},media=cdrom,file=${isoPath},readonly=on`,
    '-device', `ide-cd,bus=ahci0.1,drive=${qemu.cdromDeviceId}`,
    // once=d — CD грузится ТОЛЬКО на самом первом старте этого qemu-
    // процесса (совпадает с confirmCdBootPrompt(), который ловит именно
    // этот момент). Все последующие ребуты — а Windows Setup перезагружает
    // VM саму несколько раз в процессе установки — идут сразу с диска
    // (order=c), без повторного обращения к CD. Без этого разделения
    // повторная загрузка с установочного носителя на промежуточном ребуте
    // срывает уже начатую установку ("Windows could not complete the
    // installation") — воспроизведено и измерено эмпирически.
    '-boot', qemu.bootFromInstaller ? 'once=d,order=c' : 'order=cd',
    '-netdev', `user,id=net0${hostfwd}`,
    '-device', `${qemu.netDevice},netdev=net0`,
    // TPM: control-канал у swtpm — unix-сокет (см. tpm.ctrlSocketPath в
    // config.js, почему именно unix — единственное исключение из общего
    // tcp-правила). qemu подключается клиентом, swtpm уже слушает к этому
    // моменту — run-vm.js гарантирует порядок запуска.
    '-chardev', `socket,id=chrtpm,path=${tpm.ctrlSocketPath}`,
    '-tpmdev', 'emulator,id=tpm0,chardev=chrtpm',
    '-device', 'tpm-tis,tpmdev=tpm0',
    '-device', 'qemu-xhci,id=usb0',
    '-device', 'usb-tablet,bus=usb0.0',
    // Файл ответов — отдельный съёмный USB-накопитель (не тот же носитель,
    // что ISO): Windows Setup ищет autounattend.xml только на removable
    // media, актуально лишь пока идёт установка.
    ...(qemu.bootFromInstaller ? [
      '-drive', `if=none,id=${unattend.answerFileDeviceId},format=raw,file=${unattend.answerFileImagePath},readonly=on`,
      '-device', `usb-storage,bus=usb0.0,drive=${unattend.answerFileDeviceId},removable=true`,
    ] : []),
    '-vga', 'qxl',
    '-display', 'none', // никаких локальных GTK/SDL-окон — это служба
    ...buildDisplayTransportArgs(qemu, network.loopbackHost),
    // QMP — управление скриптом/агентом (screendump, sendkey, powerdown).
    '-qmp', `tcp:${network.loopbackHost}:${qemu.qmpPort},server,nowait`,
    // Два независимых ISA-serial порта — стандартная возможность q35/PC
    // machine type (не хак под конкретную версию Windows), каждому
    // последовательному `-serial` соответствует следующий COM гостя по
    // порядку (COM1, затем COM2), без отдельного драйвера.
    //  - COM1 = только лог (Write-ComLog), host читает через
    //    capture-serial-log.js.
    //  - COM2 = только serial command agent (serve-serial-command.ps1),
    //    двусторонний, host пишет и читает через execute-serial-command.js.
    // Разделены физически, а не только по протоколу — см. комментарий у
    // qemu.serialLogTcpPort/serialCommandTcpPort в data/config.json5 про
    // то, почему один общий COM тут не годится.
    '-chardev', `socket,id=com1,host=${network.loopbackHost},port=${qemu.serialLogTcpPort},server=on,wait=off`,
    '-serial', 'chardev:com1',
    '-chardev', `socket,id=com2,host=${network.loopbackHost},port=${qemu.serialCommandTcpPort},server=on,wait=off`,
    '-serial', 'chardev:com2',
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
