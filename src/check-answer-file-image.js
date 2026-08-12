import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mount } from 'libmount';
import { config } from './config.js';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// Проверяет собранный FAT-образ независимо от QEMU: нужные файлы лежат в
// корне, а ZIP внутри образа совпадает с закреплённой контрольной суммой.
export function checkAnswerFileImage() {
  const { unattend, openSsh } = config;
  if (!existsSync(unattend.answerFileImagePath)) {
    throw new Error(`нет USB-образа: ${unattend.answerFileImagePath}. Сначала запусти build-answer-file-image.js`);
  }

  const disk = mount(readFileSync(unattend.answerFileImagePath));
  const fs = disk.getFileSystem();
  if (!fs) throw new Error('USB-образ не содержит распознаваемой FAT filesystem');
  const root = fs.getRoot();
  const expectedNames = [
    unattend.answerFileFilename,
    '_lib-guest-script-prelude.ps1',
    ...unattend.firstLogonScripts,
    ...unattend.supportingGuestScripts,
    openSsh.archiveFilename,
    openSsh.clientPublicKeyFilename,
  ];
  for (const filename of expectedNames) {
    if (!root.getFile(filename)?.isRegularFile()) {
      throw new Error(`USB-образ: отсутствует файл ${filename}`);
    }
  }

  const archiveData = root.getFile(openSsh.archiveFilename).open().readData();
  const actualSha256 = sha256(archiveData);
  if (actualSha256 !== openSsh.expectedSha256) {
    throw new Error(`USB-образ: SHA-256 OpenSSH ${actualSha256} не совпадает с ${openSsh.expectedSha256}`);
  }
  console.log(`USB-образ: OK (${fs.getName()}, ${expectedNames.length} required files, OpenSSH SHA-256 verified)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    checkAnswerFileImage();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
