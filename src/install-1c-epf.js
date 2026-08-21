import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { buildEnterpriseArguments, buildWindowsArgumentLine } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from './lib/execute-guest-powershell-file.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory, stageGuestFiles } from './lib/stage-guest-files.js';

function buildCopyEpfScript(oneCConfiguration, remoteEpfPath) {
    const { database, epf } = oneCConfiguration;
    const targetPath = path.win32.join(epf.targetDirectory, epf.targetFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        `$databaseDirectory = ${quotePowerShell(database.directory)}`,
        `$targetDirectory = ${quotePowerShell(epf.targetDirectory)}`,
        `$targetPath = ${quotePowerShell(targetPath)}`,
        'if (-not (Test-Path -LiteralPath (Join-Path $databaseDirectory "1Cv8.1CD") -PathType Leaf)) { throw "install 1C EPF: configured infobase is missing" }',
        'New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null',
        `Copy-Item -LiteralPath ${quotePowerShell(remoteEpfPath)} -Destination $targetPath -Force`,
        `$expectedSha256 = ${quotePowerShell(oneCConfiguration.artifacts.epf.expectedSha256)}`,
        '$actualSha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()',
        'if ($actualSha256 -ne $expectedSha256) { throw "install 1C EPF: copied EPF SHA-256 mismatch" }',
    ].join('\n');
}

function buildEpfExecutionScript(oneC, oneCConfiguration) {
    const { epf } = oneCConfiguration;
    const targetPath = path.win32.join(epf.targetDirectory, epf.targetFilename);
    const argumentLine = buildWindowsArgumentLine(buildEnterpriseArguments(oneCConfiguration, ['/Execute', targetPath]));
    return [
        '$ErrorActionPreference = "Stop"',
        `$oneCExecutable = ${quotePowerShell(`${oneC.installationDirectory}\\bin\\1cv8.exe`)}`,
        `$targetDirectory = ${quotePowerShell(epf.targetDirectory)}`,
        `$argumentLine = ${quotePowerShell(argumentLine)}`,
        `if (${epf.executeAfterInstall ? '$true' : '$false'}) {`,
        '  $process = Start-Process -FilePath $oneCExecutable -ArgumentList $argumentLine -WorkingDirectory $targetDirectory -PassThru',
        '  if ($null -eq $process -or $process.Id -le 0) { throw "install 1C EPF: Enterprise process did not start" }',
        '  [ordered]@{ executed = $true; processId = $process.Id } | ConvertTo-Json -Compress',
        '} else {',
        '  [ordered]@{ executed = $false } | ConvertTo-Json -Compress',
        '}',
    ].join('\n');
}

function buildEpfShortcutArguments(oneC, oneCConfiguration) {
    const { epf } = oneCConfiguration;
    const targetPath = path.win32.join(epf.targetDirectory, epf.targetFilename);
    return [
        epf.shortcutPath,
        `${oneC.installationDirectory}\\bin\\1cv8.exe`,
        buildWindowsArgumentLine(buildEnterpriseArguments(oneCConfiguration, ['/Execute', targetPath])),
        epf.targetDirectory,
        epf.shortcutDescription,
    ];
}

export async function installOneCEpf() {
    const { oneC, oneCConfiguration, paths } = config;
    const [epf] = await assertArtifactFiles(oneCConfiguration.sourceDirectory, [oneCConfiguration.artifacts.epf]);
    let ssh = await connectGuestSsh();
    let remoteDirectory;
    let installFinished = false;
    try {
        const platformState = await readOneCPlatformState(ssh, oneC);
        if (!isOneCPlatformInstalled(platformState, oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(platformState)}`);
        }
        remoteDirectory = await stageGuestFiles(ssh, {
            stagingRoot: oneCConfiguration.guest.stagingDirectory,
            files: [epf],
        });
        const remoteEpfPath = path.win32.join(remoteDirectory, epf.filename);
        await executeGuestPowerShell(
            ssh,
            buildCopyEpfScript(oneCConfiguration, remoteEpfPath),
            'copy 1C EPF',
        );
        await executeGuestPowerShellFile(ssh, {
            localPath: path.join(paths.guestScriptsDir, oneCConfiguration.guest.shortcutScriptFilename),
            remotePath: path.win32.join(remoteDirectory, oneCConfiguration.guest.shortcutScriptFilename),
            argumentsList: buildEpfShortcutArguments(oneC, oneCConfiguration),
            label: 'create 1C EPF shortcut',
        });
        const output = await executeGuestPowerShell(
            ssh,
            buildEpfExecutionScript(oneC, oneCConfiguration),
            'execute 1C EPF',
        );
        let result;
        try {
            result = JSON.parse(output);
        } catch (error) {
            throw new Error(`install 1C EPF: invalid JSON from guest: ${error.message}: ${output}`);
        }
        installFinished = true;
        await removeGuestDirectory(ssh, remoteDirectory);
        remoteDirectory = undefined;
        console.log(result.executed ? `1C EPF: installed and executed (PID ${result.processId})` : '1C EPF: installed');
    } finally {
        if (remoteDirectory && installFinished) await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        ssh?.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCEpf().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
