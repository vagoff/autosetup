import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { buildDesignerArguments, buildOneCCommandScript } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory, stageGuestFiles } from './lib/stage-guest-files.js';

function assertReplaceableInfobaseDirectory(directory) {
    const normalized = path.win32.normalize(directory);
    if (normalized === path.win32.parse(normalized).root) {
        throw new Error(`1C infobase directory must not be a filesystem root: ${directory}`);
    }
}

function buildRestoreScript(oneC, oneCConfiguration, remoteDtPath) {
    const { database, guest } = oneCConfiguration;
    const logPath = path.win32.join(guest.logDirectory, guest.restoreLogFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        `$databaseDirectory = ${quotePowerShell(database.directory)}`,
        `$logDirectory = ${quotePowerShell(guest.logDirectory)}`,
        'New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null',
        // RestoreIB не делает merge: это намеренный reset в точно заданный
        // каталог, поэтому безопасно повторяет восстановление после опытов.
        'if (Test-Path -LiteralPath $databaseDirectory) { Remove-Item -LiteralPath $databaseDirectory -Recurse -Force }',
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
        '$databaseFile = Join-Path $databaseDirectory "1Cv8.1CD"',
        'if (-not (Test-Path -LiteralPath $databaseFile -PathType Leaf)) { throw "restore 1C infobase: 1Cv8.1CD is missing after successful Designer exit" }',
    ].join('\n');
}

export async function restoreOneCInfobase() {
    const { oneC, oneCConfiguration } = config;
    assertReplaceableInfobaseDirectory(oneCConfiguration.database.directory);
    const [dt] = await assertArtifactFiles(oneCConfiguration.sourceDirectory, [oneCConfiguration.artifacts.dt]);
    let ssh = await connectGuestSsh();
    let remoteDirectory;
    let restoreFinished = false;
    try {
        const platformState = await readOneCPlatformState(ssh, oneC);
        if (!isOneCPlatformInstalled(platformState, oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(platformState)}`);
        }
        remoteDirectory = await stageGuestFiles(ssh, {
            stagingRoot: oneCConfiguration.guest.stagingDirectory,
            files: [dt],
        });
        await executeGuestPowerShell(
            ssh,
            buildRestoreScript(oneC, oneCConfiguration, path.win32.join(remoteDirectory, dt.filename)),
            'restore 1C infobase',
        );
        restoreFinished = true;
        await removeGuestDirectory(ssh, remoteDirectory);
        remoteDirectory = undefined;
        console.log('1C infobase: restored');
    } finally {
        if (remoteDirectory && restoreFinished) await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        ssh?.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    restoreOneCInfobase().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
