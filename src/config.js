import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';

// Единственный источник правды — data/config.json5 (человекоредактируемый,
// с комментариями). Этот файл только парсит его и довычисляет пути —
// никаких собственных констант тут быть не должно.
const CONFIG_FILE = '/data/wd/aibox/wintest/data/config.json5';
const raw = JSON5.parse(readFileSync(CONFIG_FILE, 'utf8'));

const { projectRoot, vmName } = raw;

const paths = {
  dataDir: path.join(projectRoot, 'data'),
  dbDir: path.join(projectRoot, 'db'),
  cacheDir: path.join(projectRoot, 'cache'),
  vmDbDir: path.join(projectRoot, 'db', vmName),
  vmCacheDir: path.join(projectRoot, 'cache', vmName),
  isoDir: path.join(projectRoot, 'cache', 'iso'),
};

export const config = {
  paths,
  windowsIso: raw.windowsIso,
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
  },
  qemu: {
    ...raw.qemu,
    vmName,
    pidFile: path.join(paths.vmCacheDir, 'qemu.pid'),
  },
};
