import path from 'node:path';
import { config } from '../configure.js';
import { assertArtifactFiles } from '../lib/assert-artifact-files.js';
import { buildEnterpriseArguments, buildInfobasePresenceCheck, buildWindowsArgumentLine } from '../infrastructure/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from '../infrastructure/execute-guest-powershell-file.js';
import { assertOneCPlatformInstalled } from '../infrastructure/read-1c-platform-state.js';
import { withGuestSession, withGuestStaging } from '../infrastructure/with-guest-session.js';

function epfTargetPath(oneCConfiguration) {
    const { epf } = oneCConfiguration;
    return path.win32.join(epf.targetDirectory, epf.targetFilename);
}

function buildEpfEnterpriseArgumentLine(oneCConfiguration) {
    return buildWindowsArgumentLine(buildEnterpriseArguments(oneCConfiguration, ['/Execute', epfTargetPath(oneCConfiguration)]));
}

function buildCopyEpfScript(oneCConfiguration, remoteEpfPath) {
    const { epf } = oneCConfiguration;
    const targetPath = epfTargetPath(oneCConfiguration);
    return [
        '$ErrorActionPreference = "Stop"',
        buildInfobasePresenceCheck(oneCConfiguration, 'install 1C EPF'),
        `$targetPath = ${quotePowerShell(targetPath)}`,
        `New-Item -ItemType Directory -Path ${quotePowerShell(epf.targetDirectory)} -Force | Out-Null`,
        `Copy-Item -LiteralPath ${quotePowerShell(remoteEpfPath)} -Destination $targetPath -Force`,
        `$expectedSha256 = ${quotePowerShell(oneCConfiguration.artifacts.epf.expectedSha256)}`,
        '$actualSha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()',
        'if ($actualSha256 -ne $expectedSha256) { throw "install 1C EPF: copied EPF SHA-256 mismatch" }',
    ].join('\n');
}

// Условие "запускать ли EPF после установки" — свойство конфига на
// стороне хоста, поэтому решается здесь: в гостя уезжает ровно тот
// сценарий, который нужен, а не оба варианта с if внутри.
function buildEpfExecutionScript(oneC, oneCConfiguration) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$process = Start-Process -FilePath ${quotePowerShell(oneC.clientExecutablePath)} -ArgumentList ${quotePowerShell(buildEpfEnterpriseArgumentLine(oneCConfiguration))} -WorkingDirectory ${quotePowerShell(oneCConfiguration.epf.targetDirectory)} -PassThru`,
        'if ($null -eq $process -or $process.Id -le 0) { throw "install 1C EPF: Enterprise process did not start" }',
        '[ordered]@{ processId = $process.Id } | ConvertTo-Json -Compress',
    ].join('\n');
}

function buildEpfShortcutArguments(oneC, oneCConfiguration) {
    const { epf } = oneCConfiguration;
    return [
        epf.shortcutPath,
        oneC.clientExecutablePath,
        buildEpfEnterpriseArgumentLine(oneCConfiguration),
        epf.targetDirectory,
        epf.shortcutDescription,
    ];
}

export async function installOneCEpf() {
    const { oneC, oneCConfiguration, paths } = config;
    const [epf] = await assertArtifactFiles(oneCConfiguration.sourceDirectory, [oneCConfiguration.artifacts.epf]);
    const executed = await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        return withGuestStaging(session, { stagingRoot: oneCConfiguration.guest.stagingDirectory, files: [epf] }, async (remoteDirectory) => {
            await executeGuestPowerShell(
                session.ssh,
                buildCopyEpfScript(oneCConfiguration, path.win32.join(remoteDirectory, epf.filename)),
                'copy 1C EPF',
            );
            await executeGuestPowerShellFile(session.ssh, {
                localPath: path.join(paths.guestScriptsDir, oneCConfiguration.guest.shortcutScriptFilename),
                remotePath: path.win32.join(remoteDirectory, oneCConfiguration.guest.shortcutScriptFilename),
                argumentsList: buildEpfShortcutArguments(oneC, oneCConfiguration),
                label: 'create 1C EPF shortcut',
            });
            if (!oneCConfiguration.epf.executeAfterInstall) return null;
            const output = await executeGuestPowerShell(session.ssh, buildEpfExecutionScript(oneC, oneCConfiguration), 'execute 1C EPF');
            try {
                return JSON.parse(output);
            } catch (error) {
                throw new Error(`install 1C EPF: invalid JSON from guest: ${error.message}: ${output}`);
            }
        });
    });
    console.log(executed ? `1C EPF: installed and executed (PID ${executed.processId})` : '1C EPF: installed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCEpf().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
