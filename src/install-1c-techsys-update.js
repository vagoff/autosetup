import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { quotePowerShell } from './lib/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from './lib/execute-guest-powershell-file.js';
import { isOneCTechsysUpdateInstalled, readOneCTechsysUpdateState } from './lib/read-1c-techsys-update-state.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

const TECHSYS_SCRIPT_FILENAME = 'install-1c-techsys-update.ps1';

function buildInstallScript(update, remoteDirectory) {
    const stagedUpdatePath = path.win32.join(remoteDirectory, update.filename);
    const stagedNextPath = `${update.targetPath}.next`;
    return [
        '$ErrorActionPreference = "Stop"',
        `$installationDirectory = ${quotePowerShell(path.win32.dirname(path.win32.dirname(update.targetPath)))}`,
        `$targetPath = ${quotePowerShell(update.targetPath)}`,
        `$backupPath = ${quotePowerShell(update.backupPath)}`,
        `$sourcePath = ${quotePowerShell(stagedUpdatePath)}`,
        `$nextPath = ${quotePowerShell(stagedNextPath)}`,
        `$expectedUpdateSha256 = ${quotePowerShell(update.expectedSha256)}`,
        `$expectedOriginalSha256 = ${quotePowerShell(update.expectedOriginalSha256)}`,
        '$hash = { param([string]$path) (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }',
        '$services = @(Get-CimInstance -ClassName Win32_Service | Where-Object { $_.PathName -and $_.PathName.IndexOf($installationDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0 })',
        '$stoppedServiceNames = @()',
        'try {',
        '  foreach ($service in $services) {',
        '    if ($service.State -eq "Running") { Stop-Service -Name $service.Name -ErrorAction Stop; $stoppedServiceNames += $service.Name }',
        '  }',
        '  foreach ($serviceName in $stoppedServiceNames) {',
        '    if ((Get-Service -Name $serviceName -ErrorAction Stop).Status -ne "Stopped") { throw "1C service did not stop: $serviceName" }',
        '  }',
        '  $remainingProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path.IndexOf($installationDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0 } catch { $false } })',
        '  $remainingProcessDescriptions = @($remainingProcesses | ForEach-Object { $_.Id.ToString() + \":\" + $_.ProcessName }) -join \",\"',
        '  if ($remainingProcesses.Count -ne 0) { throw "1C processes still use installation directory: $remainingProcessDescriptions" }',
        '  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { throw "original techsys.dll is missing: $targetPath" }',
        '  $targetHash = & $hash $targetPath',
        '  if ($targetHash -eq $expectedUpdateSha256) {',
        '    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf) -or ((& $hash $backupPath) -ne $expectedOriginalSha256)) { throw "updated techsys.dll has no verified original backup" }',
        '    [ordered]@{ updated = $false; stoppedServices = $stoppedServiceNames } | ConvertTo-Json -Compress',
        '    return',
        '  }',
        '  if ($targetHash -ne $expectedOriginalSha256) { throw "unexpected original techsys.dll SHA-256: $targetHash" }',
        '  if (Test-Path -LiteralPath $backupPath -PathType Leaf) {',
        '    if ((& $hash $backupPath) -ne $expectedOriginalSha256) { throw "existing techsys backup has unexpected SHA-256" }',
        '  } else {',
        '    Copy-Item -LiteralPath $targetPath -Destination $backupPath -ErrorAction Stop',
        '    if ((& $hash $backupPath) -ne $expectedOriginalSha256) { throw "techsys backup verification failed" }',
        '  }',
        '  Copy-Item -LiteralPath $sourcePath -Destination $nextPath -Force -ErrorAction Stop',
        '  if ((& $hash $nextPath) -ne $expectedUpdateSha256) { throw "staged techsys update verification failed" }',
        '  Move-Item -LiteralPath $nextPath -Destination $targetPath -Force -ErrorAction Stop',
        '  if ((& $hash $targetPath) -ne $expectedUpdateSha256) { Copy-Item -LiteralPath $backupPath -Destination $targetPath -Force -ErrorAction Stop; throw "installed techsys update verification failed; original restored" }',
        '  [ordered]@{ updated = $true; stoppedServices = $stoppedServiceNames } | ConvertTo-Json -Compress',
        '} finally {',
        '  Remove-Item -LiteralPath $nextPath -Force -ErrorAction SilentlyContinue',
        '  foreach ($serviceName in $stoppedServiceNames) { Start-Service -Name $serviceName -ErrorAction Stop }',
        '}',
    ].join('\n');
}

export async function installOneCTechsysUpdate() {
    const { oneCTechsysUpdate } = config;
    const files = await assertArtifactFiles(oneCTechsysUpdate.sourceDirectory, [{
        filename: oneCTechsysUpdate.filename,
        expectedBytes: oneCTechsysUpdate.expectedBytes,
        expectedSha256: oneCTechsysUpdate.expectedSha256,
    }]);
    const message = await withGuestSession(async (session) => {
        const initialState = await readOneCTechsysUpdateState(session.ssh, oneCTechsysUpdate);
        if (isOneCTechsysUpdateInstalled(initialState, oneCTechsysUpdate)) return '1C techsys update: already installed';

        const result = await withGuestStaging(session, { stagingRoot: oneCTechsysUpdate.guest.stagingDirectory, files }, async (remoteDirectory) => {
            // Сценарий пишется в cache/, а не уезжает -EncodedCommand:
            // он длиннее лимита командной строки cmd.exe.
            const localScriptPath = path.join(config.paths.vmCacheDir, TECHSYS_SCRIPT_FILENAME);
            mkdirSync(config.paths.vmCacheDir, { recursive: true });
            writeFileSync(localScriptPath, buildInstallScript(oneCTechsysUpdate, remoteDirectory));
            const output = await executeGuestPowerShellFile(session.ssh, {
                localPath: localScriptPath,
                remotePath: path.win32.join(remoteDirectory, TECHSYS_SCRIPT_FILENAME),
                argumentsList: [],
                label: 'install 1C techsys update',
            });
            try {
                return JSON.parse(output);
            } catch (error) {
                throw new Error(`install 1C techsys update: invalid JSON from guest: ${error.message}: ${output}`);
            }
        });

        const finalState = await readOneCTechsysUpdateState(session.ssh, oneCTechsysUpdate);
        if (!isOneCTechsysUpdateInstalled(finalState, oneCTechsysUpdate)) {
            throw new Error(`1C techsys update verification failed: ${JSON.stringify(finalState)}`);
        }
        return `1C techsys update: installed (services restarted: ${result.stoppedServices.join(', ') || 'none'})`;
    });
    console.log(message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCTechsysUpdate().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
