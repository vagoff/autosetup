import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { buildEnterpriseArguments, buildInfobasePresenceCheck, buildWindowsArgumentLine } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from './lib/execute-guest-powershell-file.js';
import { hashFileSha256 } from './lib/hash-file-sha256.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory } from './lib/stage-guest-files.js';
import { withGuestSession } from './lib/with-guest-session.js';

const forbiddenRoleNames = new Set(['ПолныеПрава', 'FullAccess']);
const allowedOperations = new Set(['read', 'create', 'update', 'delete']);

// Пары (полное имя объекта метаданных, декларированные OData-операции).
// Единственный источник как для состава публикации, так и для манифеста
// RIGHT=, который EPF сверяет с фактическими правами назначенных ролей
// (см. заголовок Module.bsl про статичность CRUD-прав платформы).
export function getPublishedRights(oneCOData) {
    const rights = oneCOData.rights;
    if (!rights) return null;
    const result = [];
    for (const [name, operations] of Object.entries(rights)) {
        validateOperations(`rights.${name}`, operations);
        result.push({ fullName: `Документ.${name}`, operations });
    }
    for (const [name, operations] of Object.entries(oneCOData.catalogRights ?? {})) {
        validateOperations(`catalogRights.${name}`, operations);
        result.push({ fullName: `Справочник.${name}`, operations });
    }
    return result;
}

export function getPublishedMetadataNames(oneCOData) {
    const rights = getPublishedRights(oneCOData);
    return rights ? rights.map((entry) => entry.fullName) : null;
}

function validateOperations(name, operations) {
    if (!Array.isArray(operations) || operations.length === 0) throw new Error(`${name} must be a non-empty operations array`);
    for (const operation of operations) {
        if (!allowedOperations.has(operation)) throw new Error(`${name}: unsupported OData operation ${operation}`);
    }
}

export function assertODataConfiguration(oneCOData) {
    if (!Array.isArray(oneCOData.user.roleNames) || oneCOData.user.roleNames.length === 0) throw new Error('OData user must have explicit static roles');
    for (const roleName of oneCOData.user.roleNames) {
        if (forbiddenRoleNames.has(roleName)) throw new Error(`OData user must not receive forbidden role ${roleName}`);
    }
    getPublishedMetadataNames(oneCOData);
}

export function renderODataVrd(oneCOData, oneCConfiguration) {
    const base = `/${oneCOData.publicationName}`;
    const ib = `File=&quot;${oneCConfiguration.database.directory.replaceAll('\\', '\\\\')}&quot;;`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<point xmlns="http://v8.1c.ru/8.2/virtual-resource-system" base="${base}" ib="${ib}" enable="false">\n  <standardOdata enable="true" reuseSessions="autouse" sessionMaxAge="20" poolSize="10" poolTimeout="5"/>\n</point>\n`;
}

async function ensurePassword(oneCOData) {
    if (existsSync(oneCOData.passwordStatePath)) {
        const password = (await readFile(oneCOData.passwordStatePath, 'utf8')).trim();
        if (password.length !== oneCOData.user.passwordLength) throw new Error(`OData password state has unexpected length: ${oneCOData.passwordStatePath}`);
        return password;
    }
    const password = randomBytes(oneCOData.user.passwordLength * 2).toString('base64url').slice(0, oneCOData.user.passwordLength);
    await mkdir(path.dirname(oneCOData.passwordStatePath), { recursive: true });
    await writeFile(oneCOData.passwordStatePath, `${password}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(oneCOData.passwordStatePath, 0o600);
    return password;
}

async function collectSourceFiles(directory) {
    const files = [];
    async function visit(relativeDirectory) {
        for (const entry of await readdir(path.join(directory, relativeDirectory), { withFileTypes: true })) {
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) await visit(relativePath);
            else if (entry.isFile()) {
                const filePath = path.join(directory, relativePath);
                files.push({ filePath, relativePath, bytes: (await stat(filePath)).size, sha256: await hashFileSha256(filePath) });
            } else throw new Error(`OData publisher source has unsupported entry: ${relativePath}`);
        }
    }
    await visit('');
    return files;
}

function renderManifest(oneCOData, password) {
    const rights = getPublishedRights(oneCOData);
    if (!rights) throw new Error('publishing all metadata is not implemented until a static minimal role set is declared');
    return [
        `USER=${oneCOData.user.name}`,
        `PASSWORD=${password}`,
        ...rights.map((entry) => `TYPE=${entry.fullName}`),
        ...oneCOData.user.roleNames.map((name) => `ROLE=${name}`),
        ...rights.map((entry) => `RIGHT=${entry.fullName}:${entry.operations.join(',')}`),
        '',
    ].join('\n');
}

async function stagePublisher(ssh, oneCOData, password) {
    const remoteDirectory = path.win32.join(oneCOData.guest.stagingDirectory, randomUUID());
    const remoteSourceDirectory = path.win32.join(remoteDirectory, 'source');
    const sourceFiles = await collectSourceFiles(oneCOData.publisher.sourceDirectory);
    const manifest = renderManifest(oneCOData, password);
    await executeGuestPowerShell(ssh, `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteSourceDirectory)} -Force | Out-Null`, 'create OData publisher staging directory');
    try {
        for (const file of sourceFiles) {
            const remotePath = path.win32.join(remoteSourceDirectory, file.relativePath);
            await executeGuestPowerShell(ssh, `New-Item -ItemType Directory -Path ${quotePowerShell(path.win32.dirname(remotePath))} -Force | Out-Null`, 'create OData publisher source parent');
            await ssh.putFile(file.filePath, remotePath);
        }
        const stagedFiles = sourceFiles.map((file) => (
            `[pscustomobject]@{ Path = ${quotePowerShell(path.win32.join(remoteSourceDirectory, file.relativePath))}; Bytes = ${file.bytes}; Sha256 = ${quotePowerShell(file.sha256) } }`
        )).join(',\n');
        await executeGuestPowerShell(ssh, [
            '$ErrorActionPreference = "Stop"',
            `$files = @(${stagedFiles})`,
            'foreach ($file in $files) {',
            '  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) { throw "staged OData publisher file is missing: $($file.Path)" }',
            '  if ((Get-Item -LiteralPath $file.Path).Length -ne $file.Bytes) { throw "staged OData publisher file size mismatch: $($file.Path)" }',
            '  $actual = (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash.ToLowerInvariant()',
            '  if ($actual -ne $file.Sha256) { throw "staged OData publisher file SHA-256 mismatch: $($file.Path)" }',
            '}',
        ].join('\n'), 'verify OData publisher staging');
        const remoteManifestPath = path.win32.join(remoteDirectory, oneCOData.publisher.manifestFilename);
        await executeGuestPowerShell(ssh, `[IO.File]::WriteAllText(${quotePowerShell(remoteManifestPath)}, ${quotePowerShell(manifest)}, [Text.UTF8Encoding]::new($false))`, 'write OData publisher manifest');
        return { remoteDirectory, remoteSourceDirectory, remoteManifestPath };
    } catch (error) {
        await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        throw error;
    }
}

function buildPublisherArguments(oneCConfiguration, oneCOData, staged, mode) {
    const compilerInfobase = path.win32.join(staged.remoteDirectory, 'compiler-infobase');
    const epfPath = path.win32.join(staged.remoteDirectory, 'odata-publisher.epf');
    const resultPath = path.win32.join(staged.remoteDirectory, 'result.json');
    const buildLogPath = path.win32.join(oneCOData.guest.logDirectory, '1c-odata-publisher-build.log');
    const executionLogPath = path.win32.join(oneCOData.guest.logDirectory, oneCOData.guest.publicationLogFilename);
    const designerArguments = ['DESIGNER', '/F', compilerInfobase, '/DisableStartupMessages', '/DisableStartupDialogs', '/Out', buildLogPath,
        '/LoadExternalDataProcessorOrReportFromFiles', path.win32.join(staged.remoteSourceDirectory, oneCOData.publisher.rootXmlFilename), epfPath];
    const enterpriseArguments = buildEnterpriseArguments(oneCConfiguration, ['/Execute', epfPath, '/Out', executionLogPath, '/L', oneCConfiguration.database.languageCode]);
    return {
        compilerInfobase, epfPath, resultPath, buildLogPath, executionLogPath,
        buildEpfArguments: buildWindowsArgumentLine(designerArguments),
        runEpfArguments: `${buildWindowsArgumentLine(enterpriseArguments)} /C"Mode=${mode};Manifest=${staged.remoteManifestPath};ResultFile=${resultPath}"`,
    };
}

function buildWebPublicationScript(oneC, oneCConfiguration, oneCOData, apacheHttpd, remoteDirectory) {
    const descriptorPath = path.win32.join(remoteDirectory, oneCOData.web.descriptorFilename);
    const webinstPath = path.win32.join(oneC.installationDirectory, 'bin', 'webinst.exe');
    const httpdConfPath = path.win32.join(apacheHttpd.installationDirectory, 'conf', 'httpd.conf');
    const httpdPath = path.win32.join(apacheHttpd.installationDirectory, 'bin', 'httpd.exe');
    const descriptor = renderODataVrd(oneCOData, oneCConfiguration);
    const argumentsList = ['-publish', '-apache24', '-wsdir', oneCOData.publicationName, '-dir', oneCOData.web.publicationDirectory,
        '-connstr', `File="${oneCConfiguration.database.directory}";`, '-confpath', httpdConfPath, '-descriptor', descriptorPath];
    return [
        '$ErrorActionPreference = "Stop"',
        buildInfobasePresenceCheck(oneCConfiguration, 'publish 1C OData'),
        `New-Item -ItemType Directory -Path ${quotePowerShell(oneCOData.web.publicationDirectory)} -Force | Out-Null`,
        `[IO.File]::WriteAllText(${quotePowerShell(descriptorPath)}, ${quotePowerShell(descriptor)}, [Text.UTF8Encoding]::new($false))`,
        `$process = Start-Process -FilePath ${quotePowerShell(webinstPath)} -ArgumentList ${quotePowerShell(buildWindowsArgumentLine(argumentsList))} -Wait -PassThru`,
        'if ($process.ExitCode -ne 0) { throw "webinst publish failed: $($process.ExitCode)" }',
        `& ${quotePowerShell(httpdPath)} -t`,
        'if ($LASTEXITCODE -ne 0) { throw "Apache configuration validation failed after OData publication" }',
        `Restart-Service -Name ${quotePowerShell(apacheHttpd.serviceName)} -ErrorAction Stop`,
    ].join('\n');
}

export async function publishOneCOData({ mode = 'apply' } = {}) {
    if (mode !== 'apply' && mode !== 'probe') throw new Error(`unsupported OData publisher mode: ${mode}`);
    const { oneC, oneCConfiguration, oneCOData, apacheHttpd, paths, network } = config;
    assertODataConfiguration(oneCOData);
    const password = await ensurePassword(oneCOData);
    const report = await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        const staged = await stagePublisher(session.ssh, oneCOData, password);
        let succeeded = false;
        let output;
        try {
            const runner = buildPublisherArguments(oneCConfiguration, oneCOData, staged, mode);
            output = await executeGuestPowerShellFile(session.ssh, {
                localPath: path.join(paths.guestScriptsDir, oneCOData.publisher.runnerScriptFilename),
                remotePath: path.win32.join(staged.remoteDirectory, oneCOData.publisher.runnerScriptFilename),
                argumentsList: [
                    oneC.clientExecutablePath,
                    oneC.thinClientExecutablePath,
                    runner.compilerInfobase,
                    runner.epfPath,
                    runner.resultPath,
                    runner.buildLogPath,
                    runner.executionLogPath,
                    oneCOData.publisher.timeoutSeconds,
                    runner.buildEpfArguments,
                    runner.runEpfArguments,
                    '\\staging\\1c-odata\\',
                    'OData publisher',
                ],
                label: 'run native 1C OData publisher',
            });
            const result = JSON.parse(Buffer.from(output.trim(), 'base64').toString('utf8'));
            if (result.ok !== true) throw new Error(`native 1C OData publisher failed: ${result.error || output}`);
            if (mode === 'probe') {
                succeeded = true;
                return result;
            }
            await executeGuestPowerShell(session.ssh, buildWebPublicationScript(oneC, oneCConfiguration, oneCOData, apacheHttpd, staged.remoteDirectory), 'publish 1C OData to Apache');
            succeeded = true;
            return result;
        } finally {
            if (succeeded) await removeGuestDirectory(session.ssh, staged.remoteDirectory);
        }
    });
    if (mode === 'probe') {
        console.log(JSON.stringify({ ok: true, mode, ...report }, null, 2));
        return report;
    }
    const baseUrl = `http://${network.loopbackHost}:${apacheHttpd.hostPort}/${oneCOData.publicationName}/${oneCOData.endpointPath}`;
    const response = await fetch(`${baseUrl}/$metadata`, { headers: { authorization: `Basic ${Buffer.from(`${oneCOData.user.name}:${password}`).toString('base64')}` }, signal: AbortSignal.timeout(oneCOData.guest.healthCheckTimeoutMs) });
    if (!response.ok) throw new Error(`OData metadata health check failed: HTTP ${response.status}`);
    const metadata = await response.text();
    for (const name of getPublishedMetadataNames(oneCOData) ?? []) {
        const entityName = name.replace('Документ.', 'Document_').replace('Справочник.', 'Catalog_');
        if (!metadata.includes(`Name="${entityName}"`)) throw new Error(`OData metadata lacks ${entityName}`);
    }
    console.log(JSON.stringify({ ok: true, baseUrl, user: oneCOData.user.name, ...report }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const mode = process.argv.slice(2).length === 0 ? 'apply' : process.argv[2] === '--probe' ? 'probe' : null;
    if (!mode) {
        console.error('usage: node src/publish-1c-odata.js [--probe]');
        process.exit(1);
    }
    publishOneCOData({ mode }).catch((error) => { console.error(error.message); process.exit(1); });
}
