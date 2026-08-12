import { writeFileSync } from 'node:fs';
import { mkfsvfat, mount } from 'libmount';
import { renderAutounattendXml } from './lib/render-autounattend-xml.js';
import { config } from './config.js';

// Собирает маленький FAT12-образ диска с единственным файлом
// autounattend.xml в корне — Windows Setup сам находит его на любом
// подключённом removable-носителе, без выбора вручную. Чистый build-
// артефакт из конфига (см. config.unattend.answerFileImagePath) — всегда
// пересоздаётся заново, никакого накопленного состояния тут нет, поэтому
// в отличие от create-disk-image.js и др. никакого fail-fast-guard на
// "уже существует" не нужно.
export function buildAnswerFileImage() {
  const { unattend } = config;
  const { answerFileImageSizeBytes, answerFileFilename, answerFileImagePath } = unattend;

  // label — опциональный, ожидает уже закодированный в OEM-кодовую
  // страницу Uint8Array (внутренний хелпер libmount под это не
  // экспортирован публично) — пропускаем, Setup на метку тома не смотрит.
  const format = mkfsvfat(answerFileImageSizeBytes, { type: 'FAT12' });
  if (!format) {
    throw new Error(`libmount.mkfsvfat отказался форматировать образ размером ${answerFileImageSizeBytes} байт`);
  }

  const image = new Uint8Array(answerFileImageSizeBytes);
  const disk = mount(image);
  disk.write(format.sectors);

  const fs = disk.getFileSystem();
  if (!fs) {
    throw new Error('libmount: файловая система не примонтировалась сразу после форматирования');
  }

  const xml = renderAutounattendXml(unattend);
  const file = fs.getRoot().makeFile(answerFileFilename);
  if (!file) {
    throw new Error(`libmount: не смог создать файл "${answerFileFilename}" в корне образа`);
  }
  file.open().writeData(new TextEncoder().encode(xml));

  writeFileSync(answerFileImagePath, image);
  console.log(`собран ${answerFileImagePath} (${answerFileFilename}, ${xml.length} байт XML)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    buildAnswerFileImage();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
