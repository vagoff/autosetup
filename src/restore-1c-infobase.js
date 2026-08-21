import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { buildDesignerArguments, buildOneCCommandScript } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

function buildRestoreScript(oneC, oneCConfiguration, remoteDtPath) {
    const { database, guest } = oneCConfiguration;
    const logPath = path.win32.join(guest.logDirectory, guest.restoreLogFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        `$databaseDirectory = ${quotePowerShell(database.directory)}`,
        `$databaseFile = Join-Path $databaseDirectory ${quotePowerShell(oneCConfiguration.database.fileFilename)}`,
        `$logDirectory = ${quotePowerShell(guest.logDirectory)}`,
        'New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null',
        // Каталог сносится целиком (RestoreIB не делает merge), поэтому
        // сначала доказываем, что это действительно каталог файловой базы,
        // а не что-то ещё: существует и содержит 1Cv8.1CD, либо не
        // существует вовсе. Опечатка в конфиге (C:\Users, C:\Program Files)
        // обязана падать ошибкой, а не удалять чужие данные.
        'if (Test-Path -LiteralPath $databaseDirectory) {',
        '  if (-not (Test-Path -LiteralPath $databaseFile -PathType Leaf)) {',
        '    throw "restore 1C infobase: $databaseDirectory exists and is not a 1C file infobase (no $databaseFile) - refusing to delete it"',
        '  }',
        '  Remove-Item -LiteralPath $databaseDirectory -Recurse -Force',
        '}',
        'New-Item -ItemType Directory -Path $databaseDirectory -Force | Out-Null',
        buildOneCCommandScript(oneC, {
            argumentsList: buildDesignerArguments(oneCConfiguration, {
                operationArguments: ['/RestoreIB', remoteDtPath],
                logPath,
                // В пустой базе нет ещё ни одного пользователя: Admin из DT
                // появляется только после успешного RestoreIB.
                authenticate: false,
            }),
            logPath,
            variablePrefix: 'restore',
            label: 'restore 1C infobase',
        }),
        'if (-not (Test-Path -LiteralPath $databaseFile -PathType Leaf)) { throw "restore 1C infobase: infobase file is missing after successful Designer exit" }',
    ].join('\n');
}

export async function restoreOneCInfobase() {
    const { oneC, oneCConfiguration } = config;
    const [dt] = await assertArtifactFiles(oneCConfiguration.sourceDirectory, [oneCConfiguration.artifacts.dt]);
    await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        await withGuestStaging(session, { stagingRoot: oneCConfiguration.guest.stagingDirectory, files: [dt] }, async (remoteDirectory) => {
            await executeGuestPowerShell(
                session.ssh,
                buildRestoreScript(oneC, oneCConfiguration, path.win32.join(remoteDirectory, dt.filename)),
                'restore 1C infobase',
            );
        });
    });
    console.log('1C infobase: restored');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    restoreOneCInfobase().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
