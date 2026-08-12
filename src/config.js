import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';

// Единственный источник правды — data/config.json5 (человекоредактируемый,
// с комментариями). Этот файл только парсит его и довычисляет пути —
// никаких собственных констант тут быть не должно.
const CONFIG_FILE = '/data/wd/aibox/wintest/data/config.json5';
const raw = JSON5.parse(readFileSync(CONFIG_FILE, 'utf8'));

const { projectRoot, vmName } = raw;

function resolveGuestPortForward(name, owner) {
  const portForward = raw.qemu.guestPortForwards.find((forward) => forward.name === name);
  if (portForward) return portForward;
  throw new Error(`${owner}=${name}: соответствующий элемент qemu.guestPortForwards не найден`);
}

const openSshPortForward = resolveGuestPortForward(
  raw.openSsh.guestPortForwardName,
  'openSsh.guestPortForwardName'
);
const winRmPortForward = resolveGuestPortForward(
  raw.winRm.guestPortForwardName,
  'winRm.guestPortForwardName'
);

const paths = {
  dataDir: path.join(projectRoot, 'data'),
  dbDir: path.join(projectRoot, 'db'),
  cacheDir: path.join(projectRoot, 'cache'),
  vmDbDir: path.join(projectRoot, 'db', vmName),
  vmCacheDir: path.join(projectRoot, 'cache', vmName),
  isoDir: path.join(projectRoot, 'cache', 'iso'),
  // .ps1-исходники FirstLogonCommands (см. src/lib/build-first-logon-commands.js).
  guestScriptsDir: path.join(projectRoot, 'src', 'guest-scripts'),
};

export const config = {
  paths,
  network: raw.network,
  windowsIso: raw.windowsIso,
  diagnostics: raw.diagnostics,
  serialAgent: raw.serialAgent,
  openSsh: {
    ...raw.openSsh,
    archivePath: path.join(paths.cacheDir, 'openssh', raw.openSsh.archiveFilename),
    clientPrivateKeyPath: path.join(paths.vmDbDir, raw.openSsh.clientPrivateKeyFilename),
    clientPublicKeyPath: path.join(paths.vmDbDir, raw.openSsh.clientPublicKeyFilename),
    knownHostsPath: path.join(paths.vmCacheDir, raw.openSsh.check.knownHostsFilename),
    port: openSshPortForward.guestPort,
    hostPort: openSshPortForward.hostPort,
  },
  winRm: {
    ...raw.winRm,
    port: winRmPortForward.guestPort,
    hostPort: winRmPortForward.hostPort,
  },
  unattend: {
    ...raw.unattend,
    // чистый build-артефакт из конфига, без накопленного состояния —
    // поэтому в cache/, а не в db/ (в отличие от диска/OVMF vars/tpm).
    answerFileImagePath: path.join(paths.vmCacheDir, raw.unattend.answerFileFilename.replace(/\.xml$/i, '.img')),
  },
  disk: {
    ...raw.disk,
    path: path.join(paths.vmDbDir, 'disk.qcow2'),
  },
  ovmf: {
    ...raw.ovmf,
    varsPath: path.join(paths.vmDbDir, 'OVMF_VARS.fd'),
  },
  tpm: {
    ...raw.tpm,
    stateDir: path.join(paths.vmDbDir, 'tpm'),
    // сокет — рантайм-артефакт процесса, не состояние TPM, поэтому в cache,
    // а не в db (см. data/config.json5 про причину unix-сокета здесь).
    ctrlSocketPath: path.join(paths.vmCacheDir, raw.tpm.ctrlSocketFilename),
  },
  qemu: {
    ...raw.qemu,
    vmName,
    pidFile: path.join(paths.vmCacheDir, 'qemu.pid'),
    screendumpPath: path.join(paths.vmCacheDir, raw.qemu.screendumpFilename),
  },
};
