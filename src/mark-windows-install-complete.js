import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';

// Единственный надёжный сигнал, что вся цепочка FirstLogonCommands
// доехала до конца — строка "first-logon-commands: ALL DONE" от
// log-first-logon-complete.ps1 в durable-копии COM1
// (cache/<vmName>/com1.log, см. capture-serial-log.js). Этот модуль
// переводит этот факт в постоянный маркер db/<vmName>/install-complete.marker
// (см. src/lib/resolve-boot-from-installer.js — кто его читает).
//
// Stateful-ресурс: fail-fast, а не молча перезаписывает — как и
// остальные create-*.js (диск/OVMF vars/tpm state). Вызывается один раз,
// явно, после того как человек/агент уже убедился, что первый вход
// гостя завершился (например, check-ssh-access.js прошёл первый раз).
export function markWindowsInstallComplete() {
    const { serialLogPath } = config.qemu;
    const { firstLogonCompletionLogLine } = config.unattend;
    const { installCompleteMarkerPath } = config.paths;

    if (existsSync(installCompleteMarkerPath)) {
        throw new Error(`install-complete.marker уже существует: ${installCompleteMarkerPath}`);
    }
    if (!existsSync(serialLogPath)) {
        throw new Error(`нет COM1-лога: ${serialLogPath}. VM ещё ни разу не запускалась?`);
    }
    const serialLog = readFileSync(serialLogPath, 'utf8');
    if (!serialLog.includes(firstLogonCompletionLogLine)) {
        throw new Error(`в ${serialLogPath} нет строки "${firstLogonCompletionLogLine}" — install ещё не завершён`);
    }

    // exclusive create ('wx') — та же fail-fast гарантия и от гонки
    // (два параллельных вызова), а не только от повторного ручного запуска.
    writeFileSync(installCompleteMarkerPath, `${new Date().toISOString()}\n`, { flag: 'wx' });
    console.log(`отмечено: ${installCompleteMarkerPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        markWindowsInstallComplete();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
