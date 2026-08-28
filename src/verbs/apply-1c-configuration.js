import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { buildDesignerArguments, buildInfobasePresenceCheck, buildOneCCommandScript } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

function buildApplyConfigurationScript(oneC, oneCConfiguration, remoteCfPath) {
    const { guest } = oneCConfiguration;
    const loadLogPath = path.win32.join(guest.logDirectory, guest.loadConfigurationLogFilename);
    const updateLogPath = path.win32.join(guest.logDirectory, guest.updateDatabaseConfigurationLogFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        buildInfobasePresenceCheck(oneCConfiguration, 'apply 1C configuration'),
        `New-Item -ItemType Directory -Path ${quotePowerShell(guest.logDirectory)} -Force | Out-Null`,
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
    await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        await withGuestStaging(session, { stagingRoot: oneCConfiguration.guest.stagingDirectory, files: [cf] }, async (remoteDirectory) => {
            await executeGuestPowerShell(
                session.ssh,
                buildApplyConfigurationScript(oneC, oneCConfiguration, path.win32.join(remoteDirectory, cf.filename)),
                'apply 1C configuration',
            );
        });
    });
    console.log('1C configuration: applied');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    applyOneCConfiguration().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
