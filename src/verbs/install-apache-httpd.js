import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { isApacheHttpdInstalled, readApacheHttpdState } from './lib/read-apache-httpd-state.js';
import { waitForHttp } from './lib/wait-for-http.js';
import { restartGuestAndWait } from './lib/wait-for-guest-reboot.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

function buildEnsureServiceScript(apacheHttpd) {
    const httpdPath = path.win32.join(apacheHttpd.installationDirectory, 'bin', 'httpd.exe');
    return [
        '$ErrorActionPreference = "Stop"',
        `$httpdPath = ${quotePowerShell(httpdPath)}`,
        `$serviceName = ${quotePowerShell(apacheHttpd.serviceName)}`,
        `$firewallRuleName = ${quotePowerShell(apacheHttpd.firewallRuleName)}`,
        `$firewallRuleDisplayName = ${quotePowerShell(apacheHttpd.firewallRuleDisplayName)}`,
        `$listenPort = ${apacheHttpd.listenPort}`,
        '& $httpdPath -t',
        'if ($LASTEXITCODE -ne 0) { throw "Apache configuration validation failed" }',
        '$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue',
        'if (-not $service) {',
        '  & $httpdPath -k install -n $serviceName',
        '  if ($LASTEXITCODE -ne 0) { throw "Apache service installation failed with $LASTEXITCODE" }',
        '  $service = Get-Service -Name $serviceName -ErrorAction Stop',
        '}',
        '$firewallRule = Get-NetFirewallRule -Name $firewallRuleName -ErrorAction SilentlyContinue',
        'if (-not $firewallRule) {',
        '  New-NetFirewallRule -Name $firewallRuleName -DisplayName $firewallRuleDisplayName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $listenPort -Profile Any | Out-Null',
        '}',
        'if ($service.Status -ne "Running") { Start-Service -Name $serviceName -ErrorAction Stop }',
    ].join('\n');
}

function buildExtractScript(apacheHttpd, remoteDirectory) {
    const archivePath = path.win32.join(remoteDirectory, apacheHttpd.archiveFilename);
    const unpackDirectory = path.win32.join(remoteDirectory, 'unpacked');
    const extractedDirectory = path.win32.join(unpackDirectory, apacheHttpd.archiveRootDirectoryName);
    return [
        '$ErrorActionPreference = "Stop"',
        `$installationDirectory = ${quotePowerShell(apacheHttpd.installationDirectory)}`,
        'if (Test-Path -LiteralPath $installationDirectory) { throw "Apache target already exists: $installationDirectory" }',
        `$archivePath = ${quotePowerShell(archivePath)}`,
        `$unpackDirectory = ${quotePowerShell(unpackDirectory)}`,
        `$extractedDirectory = ${quotePowerShell(extractedDirectory)}`,
        'Expand-Archive -LiteralPath $archivePath -DestinationPath $unpackDirectory -Force',
        `if (-not (Test-Path -LiteralPath $extractedDirectory -PathType Container)) { throw ${quotePowerShell(`Apache archive has no ${apacheHttpd.archiveRootDirectoryName} directory`)} }`,
        'Move-Item -LiteralPath $extractedDirectory -Destination $installationDirectory -ErrorAction Stop',
    ].join('\n');
}

function buildInstallVisualCppRuntimeScript(apacheHttpd, remoteDirectory) {
    const runtimePath = path.win32.join(remoteDirectory, apacheHttpd.visualCppRuntime.filename);
    return [
        '$ErrorActionPreference = "Stop"',
        `$runtimePath = ${quotePowerShell(runtimePath)}`,
        '$process = Start-Process -FilePath $runtimePath -ArgumentList @("/install", "/quiet", "/norestart") -Wait -PassThru',
        '$exitCode = [int]$process.ExitCode',
        'if ($exitCode -ne 0 -and $exitCode -ne 1638 -and $exitCode -ne 3010) { throw "Visual C++ Redistributable exited with $exitCode" }',
        '[ordered]@{ rebootRequired = ($exitCode -eq 3010) } | ConvertTo-Json -Compress',
    ].join('\n');
}

function apacheArtifactFiles(apacheHttpd) {
    return [
        {
            filename: apacheHttpd.archiveFilename,
            expectedBytes: apacheHttpd.expectedBytes,
            expectedSha256: apacheHttpd.expectedSha256,
        },
        {
            filename: apacheHttpd.visualCppRuntime.filename,
            expectedBytes: apacheHttpd.visualCppRuntime.expectedBytes,
            expectedSha256: apacheHttpd.visualCppRuntime.expectedSha256,
        },
    ];
}

async function verifyApacheAccess() {
    const { apacheHttpd } = config;
    await waitForHttp({
        url: `http://${apacheHttpd.hostAddress}:${apacheHttpd.hostPort}/`,
        timeoutMs: apacheHttpd.guest.httpReadyTimeoutMs,
        pollIntervalMs: apacheHttpd.guest.httpReadyPollIntervalMs,
    });
}

export async function installApacheHttpd() {
    const { apacheHttpd } = config;
    const files = await assertArtifactFiles(apacheHttpd.sourceDirectory, apacheArtifactFiles(apacheHttpd));
    const staging = { stagingRoot: apacheHttpd.guest.stagingDirectory, files };
    await withGuestSession(async (session) => {
        const initialState = await readApacheHttpdState(session.ssh, apacheHttpd);
        if (
            initialState.exists
            && initialState.version
            && !initialState.version.includes(`Server version: Apache/${apacheHttpd.version}`)
        ) {
            throw new Error(`Apache target exists with another version: ${initialState.version}`);
        }

        const runtimeInstallation = await withGuestStaging(session, staging, async (remoteDirectory) => {
            const output = await executeGuestPowerShell(
                session.ssh,
                buildInstallVisualCppRuntimeScript(apacheHttpd, remoteDirectory),
                'install Apache Visual C++ Redistributable',
            );
            let installation;
            try {
                installation = JSON.parse(output);
            } catch (error) {
                throw new Error(`install Apache Visual C++ Redistributable: invalid JSON from guest: ${error.message}: ${output}`);
            }
            // Распаковку делаем в этом же staging, пока перезагрузка не
            // потребовалась: иначе те же ~30 МБ пришлось бы заливать второй раз.
            if (!installation.rebootRequired && !initialState.exists) {
                await executeGuestPowerShell(session.ssh, buildExtractScript(apacheHttpd, remoteDirectory), 'extract Apache HTTP Server');
            }
            return installation;
        });

        if (runtimeInstallation.rebootRequired) {
            session.ssh = await restartGuestAndWait(session.ssh, apacheHttpd.guest);
            if (!initialState.exists) {
                await withGuestStaging(session, staging, async (remoteDirectory) => {
                    await executeGuestPowerShell(session.ssh, buildExtractScript(apacheHttpd, remoteDirectory), 'extract Apache HTTP Server');
                });
            }
        }

        await executeGuestPowerShell(session.ssh, buildEnsureServiceScript(apacheHttpd), 'ensure Apache HTTP Server service');
        const finalState = await readApacheHttpdState(session.ssh, apacheHttpd);
        if (!isApacheHttpdInstalled(finalState, apacheHttpd)) {
            throw new Error(`Apache HTTP Server installation verification failed: ${JSON.stringify(finalState)}`);
        }
        await verifyApacheAccess();
    });
    console.log(`Apache HTTP Server: installed (${apacheHttpd.version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installApacheHttpd().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
