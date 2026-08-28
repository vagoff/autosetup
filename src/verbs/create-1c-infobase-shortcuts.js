import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from '../configure.js';
import { buildEnterpriseArguments, buildInfobasePresenceCheck, buildInteractiveDesignerArguments, buildWindowsArgumentLine } from '../infrastructure/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from '../infrastructure/execute-guest-powershell-file.js';
import { assertOneCPlatformInstalled } from '../infrastructure/read-1c-platform-state.js';
import { removeGuestDirectory } from '../infrastructure/stage-guest-files.js';
import { withGuestSession } from '../infrastructure/with-guest-session.js';

const SHORTCUT_ARGUMENT_BUILDERS = {
    enterprise: (oneCConfiguration) => buildEnterpriseArguments(oneCConfiguration, []),
    designer: (oneCConfiguration) => buildInteractiveDesignerArguments(oneCConfiguration),
};

function buildShortcutArguments(oneC, oneCConfiguration, shortcut, mode) {
    return [
        shortcut.path,
        oneC.clientExecutablePath,
        buildWindowsArgumentLine(SHORTCUT_ARGUMENT_BUILDERS[mode](oneCConfiguration)),
        oneCConfiguration.database.directory,
        shortcut.description,
    ];
}

export async function createOneCInfobaseShortcuts() {
    const { oneC, oneCConfiguration, paths } = config;
    await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        await executeGuestPowerShell(
            session.ssh,
            `$ErrorActionPreference = "Stop"\n${buildInfobasePresenceCheck(oneCConfiguration, 'create 1C infobase shortcuts')}`,
            'check 1C infobase for shortcuts',
        );

        const remoteDirectory = path.win32.join(oneCConfiguration.guest.stagingDirectory, randomUUID());
        await executeGuestPowerShell(
            session.ssh,
            `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
            'create shortcut staging directory',
        );
        const localShortcutScript = path.join(paths.guestScriptsDir, oneCConfiguration.guest.shortcutScriptFilename);
        const remoteShortcutScript = path.win32.join(remoteDirectory, oneCConfiguration.guest.shortcutScriptFilename);
        for (const mode of Object.keys(SHORTCUT_ARGUMENT_BUILDERS)) {
            await executeGuestPowerShellFile(session.ssh, {
                localPath: localShortcutScript,
                remotePath: remoteShortcutScript,
                argumentsList: buildShortcutArguments(oneC, oneCConfiguration, oneCConfiguration.infobaseShortcuts[mode], mode),
                label: `create 1C ${mode} shortcut`,
            });
        }
        await removeGuestDirectory(session.ssh, remoteDirectory);
    });
    console.log('1C infobase shortcuts: created');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createOneCInfobaseShortcuts().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
