import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { buildEnterpriseArguments, buildInteractiveDesignerArguments, buildWindowsArgumentLine } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from './lib/execute-guest-powershell-file.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory } from './lib/stage-guest-files.js';

function buildInfobaseCheckScript(oneCConfiguration) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$databaseDirectory = ${quotePowerShell(oneCConfiguration.database.directory)}`,
        'if (-not (Test-Path -LiteralPath (Join-Path $databaseDirectory "1Cv8.1CD") -PathType Leaf)) { throw "create 1C infobase shortcuts: configured infobase is missing" }',
    ].join('\n');
}

function buildShortcutArguments(oneC, oneCConfiguration, shortcut, mode) {
    const argumentsList = mode === 'enterprise'
        ? buildEnterpriseArguments(oneCConfiguration, [])
        : buildInteractiveDesignerArguments(oneCConfiguration);
    return [
        shortcut.path,
        `${oneC.installationDirectory}\\bin\\1cv8.exe`,
        buildWindowsArgumentLine(argumentsList),
        oneCConfiguration.database.directory,
        shortcut.description,
    ];
}

export async function createOneCInfobaseShortcuts() {
    const { oneC, oneCConfiguration, paths } = config;
    let ssh = await connectGuestSsh();
    let remoteDirectory;
    let completed = false;
    try {
        const platformState = await readOneCPlatformState(ssh, oneC);
        if (!isOneCPlatformInstalled(platformState, oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(platformState)}`);
        }
        await executeGuestPowerShell(ssh, buildInfobaseCheckScript(oneCConfiguration), 'check 1C infobase for shortcuts');
        remoteDirectory = path.win32.join(oneCConfiguration.guest.stagingDirectory, randomUUID());
        await executeGuestPowerShell(
            ssh,
            `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
            'create shortcut staging directory',
        );
        const localShortcutScript = path.join(paths.guestScriptsDir, oneCConfiguration.guest.shortcutScriptFilename);
        const remoteShortcutScript = path.win32.join(remoteDirectory, oneCConfiguration.guest.shortcutScriptFilename);
        const shortcuts = [
            ['enterprise', oneCConfiguration.infobaseShortcuts.enterprise],
            ['designer', oneCConfiguration.infobaseShortcuts.designer],
        ];
        for (const [mode, shortcut] of shortcuts) {
            await executeGuestPowerShellFile(ssh, {
                localPath: localShortcutScript,
                remotePath: remoteShortcutScript,
                argumentsList: buildShortcutArguments(oneC, oneCConfiguration, shortcut, mode),
                label: `create 1C ${mode} shortcut`,
            });
        }
        completed = true;
        await removeGuestDirectory(ssh, remoteDirectory);
        remoteDirectory = undefined;
        console.log('1C infobase shortcuts: created');
    } finally {
        if (remoteDirectory && completed) await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        ssh?.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createOneCInfobaseShortcuts().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
