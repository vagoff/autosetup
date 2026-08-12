import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { runProcess } from './lib/run-process.js';

// Создаёт пустой qcow2-диск для VM. Fail-fast если диск уже существует —
// это R/W-состояние (db/), его случайная перезапись недопустима.
export async function createDiskImage() {
  const { path: diskPath, format, sizeGiB } = config.disk;
  if (existsSync(diskPath)) {
    throw new Error(`диск уже существует: ${diskPath}. Удали явно перед пересозданием.`);
  }
  mkdirSync(path.dirname(diskPath), { recursive: true });
  await runProcess('qemu-img', ['create', '-f', format, diskPath, `${sizeGiB}G`]);
  console.log(`создан ${diskPath} (${sizeGiB}GiB, ${format})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createDiskImage().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
