import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../configure.js';
import { buildFirstLogonCommands } from '../infrastructure/build-first-logon-commands.js';
import { connectGuestSsh } from '../infrastructure/connect-guest-ssh.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';

// Выполняет ОДИН уже объявленный guest-скрипт активного профиля на
// работающей VM по SSH. Существует ради ровно одного случая: диск уже
// установлен, а скрипт (или его конфиг) появился/изменился позже —
// переустанавливать ради этого Windows незачем.
//
// Содержимое скрипта берётся не отдельной веткой рендеринга, а тем же
// buildFirstLogonCommands, который собирает USB-образ: выполняется байт
// в байт то же самое, что получила бы свежая установка (DRY — второй
// реализации того же действия не существует).
export async function executeGuestScript(filename) {
    if (!filename) throw new Error('нужен один аргумент: имя guest-скрипта, например disable-windows-updates.ps1');
    const { scriptFiles } = buildFirstLogonCommands({
        guestScriptsDir: config.paths.guestScriptsDir,
        diagnostics: config.diagnostics,
        guestFeatures: config.guestFeatures,
        firstLogonCompletionLogLine: config.unattend.firstLogonCompletionLogLine,
        windowsUpdate: config.windowsUpdate,
    });
    const script = scriptFiles.find((file) => file.filename === filename);
    if (!script) {
        throw new Error(`guest-скрипт "${filename}" не входит в активный профиль; доступны: ${scriptFiles.map((f) => f.filename).join(', ')}`);
    }
    const prelude = scriptFiles.find((file) => file.filename.startsWith('_lib-'));
    if (!prelude) throw new Error('в собранном наборе нет prelude — сломан build-first-logon-commands.js');

    const remoteDirectory = path.win32.join(config.guestScriptStagingDirectory, randomUUID());
    const ssh = await connectGuestSsh();
    try {
        await executeGuestPowerShell(
            ssh,
            `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
            `create guest script directory ${remoteDirectory}`,
        );
        // Через SFTP, а не через -EncodedCommand: cmd.exe обрезает
        // командную строку на 8191 символах, и скрипт в неё не влезает
        // (проверено — "The command line is too long").
        const localDirectory = path.join(config.paths.vmCacheDir, 'guest-scripts');
        mkdirSync(localDirectory, { recursive: true });
        for (const file of [prelude, script]) {
            const localPath = path.join(localDirectory, file.filename);
            writeFileSync(localPath, file.content, 'utf8');
            await ssh.putFile(localPath, path.win32.join(remoteDirectory, file.filename));
        }
        const output = await executeGuestPowerShell(
            ssh,
            `& ${quotePowerShell(path.win32.join(remoteDirectory, filename))}`,
            `execute guest script ${filename}`,
        );
        process.stdout.write(output);
        await executeGuestPowerShell(
            ssh,
            `Remove-Item -LiteralPath ${quotePowerShell(remoteDirectory)} -Recurse -Force -ErrorAction SilentlyContinue`,
            `remove guest script directory ${remoteDirectory}`,
        );
        console.log(`guest-скрипт выполнен: ${filename}`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    executeGuestScript(process.argv[2]).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
