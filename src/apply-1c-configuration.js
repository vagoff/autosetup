import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { buildDesignerArguments, buildOneCCommandScript } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory, stageGuestFiles } from './lib/stage-guest-files.js';

function buildApplyConfigurationScript(oneC, oneCConfiguration, remoteCfPath) {
    const { database, guest } = oneCConfiguration;
    const loadLogPath = path.win32.join(guest.logDirectory, guest.loadConfigurationLogFilename);
    const updateLogPath = path.win32.join(guest.logDirectory, guest.updateDatabaseConfigurationLogFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        `$databaseDirectory = ${quotePowerShell(database.directory)}`,
        `$logDirectory = ${quotePowerShell(guest.logDirectory)}`,
        'if (-not (Test-Path -LiteralPath (Join-Path $databaseDirectory "1Cv8.1CD") -PathType Leaf)) { throw "apply 1C configuration: configured infobase is missing" }',
        'New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null',
        buildOneCCommandScript(oneC, {
            argumentsList: buildDesignerArguments(oneCConfiguration, {
                operationArguments: ['/LoadCfg', remoteCfPath],
                logPath: loadLogPath,
                authenticate: true,
            }),
            logPath: loadLogPath,
            variablePrefix: 'loadConfiguration',
            label: 'load 1C configuration',
        }),
        buildOneCCommandScript(oneC, {
            argumentsList: buildDesignerArguments(oneCConfiguration, {
                operationArguments: ['/UpdateDBCfg'],
                logPath: updateLogPath,
                authenticate: true,
            }),
            logPath: updateLogPath,
            variablePrefix: 'updateDatabaseConfiguration',
            label: 'update 1C database configuration',
        }),
    ].join('\n');
}

export async function applyOneCConfiguration() {
    const { oneC, oneCConfiguration } = config;
    const [cf] = await assertArtifactFiles(oneCConfiguration.sourceDirectory, [oneCConfiguration.artifacts.cf]);
    let ssh = await connectGuestSsh();
    let remoteDirectory;
    let applyFinished = false;
    try {
        const platformState = await readOneCPlatformState(ssh, oneC);
        if (!isOneCPlatformInstalled(platformState, oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(platformState)}`);
        }
        remoteDirectory = await stageGuestFiles(ssh, {
            stagingRoot: oneCConfiguration.guest.stagingDirectory,
            files: [cf],
        });
        await executeGuestPowerShell(
            ssh,
            buildApplyConfigurationScript(oneC, oneCConfiguration, path.win32.join(remoteDirectory, cf.filename)),
            'apply 1C configuration',
        );
        applyFinished = true;
        await removeGuestDirectory(ssh, remoteDirectory);
        remoteDirectory = undefined;
        console.log('1C configuration: applied');
    } finally {
        if (remoteDirectory && applyFinished) await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        ssh?.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    applyOneCConfiguration().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
