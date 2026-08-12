import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolveExistingPath } from './lib/resolve-existing-path.js';

// Копирует read-write шаблон OVMF_VARS в db/ (один раз per-VM). Fail-fast
// если копия уже существует — там живёт состояние UEFI/secure-boot,
// перезаписывать нельзя.
export function provisionOvmfVars() {
  const { varsPath, varsTemplateCandidates } = config.ovmf;
  if (existsSync(varsPath)) {
    throw new Error(`OVMF vars уже существуют: ${varsPath}. Удали явно, чтобы сбросить UEFI-состояние.`);
  }
  const template = resolveExistingPath(varsTemplateCandidates, 'OVMF vars template');
  mkdirSync(path.dirname(varsPath), { recursive: true });
  copyFileSync(template, varsPath, constants.COPYFILE_EXCL);
  console.log(`провижен ${varsPath} из ${template}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    provisionOvmfVars();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
