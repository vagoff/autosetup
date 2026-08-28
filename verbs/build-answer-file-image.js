import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkfsvfat, mount } from 'libmount';
import { renderAutounattendXml } from './lib/render-autounattend-xml.js';
import { buildFirstLogonCommands } from './lib/build-first-logon-commands.js';
import { config } from './config.js';

// Собирает маленький FAT12-образ диска с единственным файлом
// autounattend.xml в корне — Windows Setup сам находит его на любом
// подключённом removable-носителе, без выбора вручную. Чистый build-
// артефакт из конфига (см. config.unattend.answerFileImagePath) — всегда
// пересоздаётся заново, никакого накопленного состояния тут нет, поэтому
// в отличие от create-disk-image.js и др. никакого fail-fast-guard на
// "уже существует" не нужно.
export function buildAnswerFileImage() {
    const { unattend, openSsh } = config;
    const { answerFileImageSizeBytes, answerFileFilename, answerFileImagePath } = unattend;

    if (!existsSync(openSsh.archivePath)) {
        throw new Error(`нет OpenSSH ZIP: ${openSsh.archivePath}. Сначала запусти download-open-ssh-archive.js`);
    }
    if (!existsSync(openSsh.clientPublicKeyPath)) {
        throw new Error(`нет SSH public key: ${openSsh.clientPublicKeyPath}. Сначала запусти create-ssh-client-key.js`);
    }

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

    // firstLogonScripts (имена .ps1-файлов) → короткие CommandLine-строки
    // (bootstrap) + реальное содержимое скриптов, которое едет на этот же
    // образ файлами (см. комментарий в build-first-logon-commands.js —
    // почему не инлайн). renderAutounattendXml остаётся агностичен к тому,
    // как получен firstLogonCommands (SRP) — просто XML-экранирует готовые
    // строки.
    const { scriptFiles, firstLogonCommands } = buildFirstLogonCommands({
        guestScriptsDir: config.paths.guestScriptsDir,
        diagnostics: config.diagnostics,
        guestFeatures: config.guestFeatures,
        firstLogonCompletionLogLine: config.unattend.firstLogonCompletionLogLine,
        windowsUpdate: config.windowsUpdate,
    });
    const xml = renderAutounattendXml({
        unattend: { ...unattend, firstLogonCommands },
        windowsUpdate: config.windowsUpdate,
    });

    const writeRootFile = (filename, content) => {
        const file = fs.getRoot().makeFile(filename);
        if (!file) {
            throw new Error(`libmount: не смог создать файл "${filename}" в корне образа`);
        }
        file.open().writeData(content);
    };

    writeRootFile(answerFileFilename, new TextEncoder().encode(xml));
    for (const { filename, content } of scriptFiles) {
        writeRootFile(filename, new TextEncoder().encode(content));
    }
    writeRootFile(openSsh.archiveFilename, readFileSync(openSsh.archivePath));
    writeRootFile(openSsh.clientPublicKeyFilename, readFileSync(openSsh.clientPublicKeyPath));

    // cache/<vmName>/ может ещё не существовать (первый запуск для этой
    // VM — до этого шага никто в конвейере его не создавал).
    mkdirSync(config.paths.vmCacheDir, { recursive: true });
    writeFileSync(answerFileImagePath, image);
    console.log(`собран ${answerFileImagePath} (${answerFileFilename} + ${scriptFiles.length} guest-скриптов + OpenSSH ZIP + SSH public key, ${xml.length} байт XML)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        buildAnswerFileImage();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
