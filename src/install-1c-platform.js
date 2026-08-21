import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';
import { restartGuestAndWait } from './lib/wait-for-guest-reboot.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

function buildInstallScript(oneC, remoteDirectory) {
    const msi = oneC.expectedFiles.find((file) => file.filename.endsWith('.msi'));
    if (!msi) throw new Error('1C platform manifest has no MSI file');
    const msiPath = path.win32.join(remoteDirectory, msi.filename);
    const transformPath = path.win32.join(remoteDirectory, oneC.transformFilename);
    const logPath = path.win32.join(oneC.guest.logDirectory, oneC.guest.msiLogFilename);
    const properties = oneC.msiProperties.map(quotePowerShell).join(', ');
    return [
        '$ErrorActionPreference = "Stop"',
        `$logDirectory = ${quotePowerShell(oneC.guest.logDirectory)}`,
        'New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null',
        `$arguments = @('/i', ${quotePowerShell(msiPath)}, '/qn', '/norestart', '/L*v', ${quotePowerShell(logPath)}, ('TRANSFORMS=' + ${quotePowerShell(transformPath)}), ${properties})`,
        // Start-Process принимает одну command line, поэтому цитируем каждый
        // аргумент сами; в частности, MSI и MST находятся в UUID-каталоге,
        // но имя MSI содержит пробел. Process.ExitCode надёжнее LASTEXITCODE
        // для Windows Installer service и отличает 0 от 3010.
        '$argumentLine = ($arguments | ForEach-Object { if ($_ -match "\\s") { \'"\' + $_ + \'"\' } else { $_ } }) -join " "',
        '$process = Start-Process -FilePath "$env:SystemRoot\\System32\\msiexec.exe" -ArgumentList $argumentLine -Wait -PassThru',
        '$exitCode = [int]$process.ExitCode',
        'if ($exitCode -ne 0 -and $exitCode -ne 3010) { throw "msiexec exited with $exitCode; see configured MSI log" }',
        '[ordered]@{ rebootRequired = ($exitCode -eq 3010) } | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function installOneCPlatform() {
    const { oneC } = config;
    const files = await assertArtifactFiles(oneC.sourceDirectory, oneC.expectedFiles);
    const alreadyInstalled = await withGuestSession(async (session) => {
        const initialState = await readOneCPlatformState(session.ssh, oneC);
        if (isOneCPlatformInstalled(initialState, oneC)) return true;

        const installation = await withGuestStaging(session, { stagingRoot: oneC.guest.stagingDirectory, files }, async (remoteDirectory) => {
            const output = await executeGuestPowerShell(session.ssh, buildInstallScript(oneC, remoteDirectory), 'install 1C platform');
            try {
                return JSON.parse(output);
            } catch (error) {
                throw new Error(`install 1C platform: invalid JSON from guest: ${error.message}: ${output}`);
            }
        });

        if (installation.rebootRequired) {
            session.ssh = await restartGuestAndWait(session.ssh, oneC.guest);
        }
        const finalState = await readOneCPlatformState(session.ssh, oneC);
        if (!isOneCPlatformInstalled(finalState, oneC)) {
            throw new Error(`1C platform installation verification failed: ${JSON.stringify(finalState)}`);
        }
        return false;
    });
    console.log(alreadyInstalled ? `1C platform: already installed (${oneC.version})` : `1C platform: installed (${oneC.version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCPlatform().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
