import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../configure.js';
import { executeGuestPowerShell, quotePowerShell } from '../../infrastructure/execute-guest-powershell.js';
import { withGuestSession, withGuestStaging } from '../../infrastructure/with-guest-session.js';

const GUEST_SCRIPTS_DIRECTORY = path.join(import.meta.dirname, 'guest-scripts');

function buildStagedFile(localPath) {
    const content = readFileSync(localPath);
    return {
        filePath: localPath,
        filename: path.basename(localPath),
        expectedBytes: statSync(localPath).size,
        expectedSha256: createHash('sha256').update(content).digest('hex'),
    };
}

function resolveGuestScriptPath(filename) {
    if (path.basename(filename) !== filename || !filename.endsWith('.ps1')) {
        throw new Error(`некорректное имя debugger guest-скрипта: ${filename}`);
    }
    return path.join(GUEST_SCRIPTS_DIRECTORY, filename);
}

// Запускает один диагностический .ps1, уже проверенный на NTFS гостя через
// withGuestStaging. Сценарий передаётся файлом; в командной строке SSH есть
// только короткий путь и короткие скалярные аргументы.
export async function runGuestDebuggerScript({ filename, argumentsList = [], label }) {
    const localPath = resolveGuestScriptPath(filename);
    const file = buildStagedFile(localPath);
    return await withGuestSession(async (session) => await withGuestStaging(
        session,
        { stagingRoot: config.diagnostics.debuggers.guestStagingDirectory, files: [file] },
        async (remoteDirectory) => {
            const remotePath = path.win32.join(remoteDirectory, file.filename);
            const argumentsCommand = argumentsList.map(quotePowerShell).join(' ');
            return await executeGuestPowerShell(
                session.ssh,
                `& ${quotePowerShell(remotePath)} ${argumentsCommand}`,
                label,
            );
        },
    ));
}

