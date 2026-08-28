import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDesignerArguments, buildInfobasePresenceCheck, buildOneCCommandScript } from './execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';
import { hashFileSha256 } from '../lib/hash-file-sha256.js';
import { extractDocumentsFromConfigurationXml } from './parse-1c-configuration-metadata.js';
import { removeGuestDirectory } from './stage-guest-files.js';

function buildDumpScript(oneC, oneCConfiguration, oneCHeadlessQuery, dumpDirectory) {
    const logPath = path.win32.join(oneCHeadlessQuery.guest.logDirectory, oneCHeadlessQuery.guest.metadataDumpLogFilename);
    return [
        '$ErrorActionPreference = "Stop"',
        buildInfobasePresenceCheck(oneCConfiguration, 'dump 1C configuration metadata'),
        `New-Item -ItemType Directory -Path ${quotePowerShell(oneCHeadlessQuery.guest.logDirectory)} -Force | Out-Null`,
        `New-Item -ItemType Directory -Path ${quotePowerShell(oneCHeadlessQuery.guest.metadataDumpRootDirectory)} -Force | Out-Null`,
        `if (Test-Path -LiteralPath ${quotePowerShell(dumpDirectory)}) { throw "1C metadata dump target already exists: ${dumpDirectory}" }`,
        buildOneCCommandScript(oneC, {
            argumentsList: buildDesignerArguments(oneCConfiguration, {
                operationArguments: ['/DumpConfigToFiles', dumpDirectory],
                logPath,
                authenticate: true,
            }),
            logPath,
            variablePrefix: 'metadataDump',
            label: 'dump 1C configuration metadata',
        }),
    ].join('\n');
}

async function putGuestJsonFile(ssh, localPath, remotePath) {
    const source = { bytes: (await stat(localPath)).size, sha256: await hashFileSha256(localPath) };
    await ssh.putFile(localPath, remotePath);
    await executeGuestPowerShell(ssh, [
        '$ErrorActionPreference = "Stop"',
        `$path = ${quotePowerShell(remotePath)}`,
        `if ((Get-Item -LiteralPath $path -ErrorAction Stop).Length -ne ${source.bytes}) { throw "headless document list size mismatch" }`,
        '$actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()',
        `if ($actual -ne ${quotePowerShell(source.sha256)}) { throw "headless document list SHA-256 mismatch" }`,
    ].join('\n'), 'verify headless document list');
}

export function buildDocumentsTopScript(oneCConfiguration, remoteDocumentListPath, top) {
    const { database } = oneCConfiguration;
    const connection = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        `$documentListPath = ${quotePowerShell(remoteDocumentListPath)}`,
        '$documents = Get-Content -LiteralPath $documentListPath -Raw -Encoding UTF8 | ConvertFrom-Json',
        "if ($documents.Count -eq 0) { throw 'Designer metadata dump contains no documents' }",
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connection)})`,
        '$result = @()',
        'foreach ($document in $documents) {',
        '  $name = [string]$document.name',
        '  try {',
        '    $query = $connection.NewObject("Query", "ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК ResultCount ИЗ Документ.$name")',
        '    $table = $query.Execute().Unload()',
        '    if ($table.Count() -ne 1) { throw "COUNT returned $($table.Count()) rows for Document.$name" }',
        '    $result += [pscustomobject]@{ name = $name; synonym = [string]$document.synonym; count = [int64]$table.Get(0).Get(0) }',
        '  } catch {',
        '    throw "COUNT Document.$name failed: $($_.Exception.Message)"',
        '  }',
        '}',
        `$result = @($result | Sort-Object @{ Expression = 'count'; Descending = $true }, @{ Expression = 'name'; Descending = $false } | Select-Object -First ${top})`,
        '$json = [ordered]@{ ok = $true; documents = $result; error = "" } | ConvertTo-Json -Compress -Depth 4',
        '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))',
    ].join('\n');
}

async function countTopDocumentsFromConfigurationXml({ ssh, oneCConfiguration, oneCHeadlessQuery, remoteDirectory, remoteConfigurationXmlPath, top }) {
    await executeGuestPowerShell(ssh, `if (-not (Test-Path -LiteralPath ${quotePowerShell(remoteConfigurationXmlPath)} -PathType Leaf)) { throw "Designer metadata dump has no ${oneCHeadlessQuery.guest.configurationXmlFilename}" }`, 'verify 1C configuration metadata dump');
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'autosetup-1c-metadata-'));
    const localConfigurationXmlPath = path.join(temporaryDirectory, oneCHeadlessQuery.guest.configurationXmlFilename);
    const localDocumentsPath = path.join(temporaryDirectory, 'documents.json');
    try {
        await ssh.getFile(localConfigurationXmlPath, remoteConfigurationXmlPath);
        const documents = extractDocumentsFromConfigurationXml(await readFile(localConfigurationXmlPath, 'utf8'));
        await writeFile(localDocumentsPath, `${JSON.stringify(documents)}\n`, 'utf8');
        const remoteDocumentsPath = path.win32.join(remoteDirectory, 'documents.json');
        await putGuestJsonFile(ssh, localDocumentsPath, remoteDocumentsPath);
        const output = await executeGuestPowerShell(
            ssh,
            buildDocumentsTopScript(oneCConfiguration, remoteDocumentsPath, top),
            'count 1C documents through COM connector',
        );
        const result = JSON.parse(Buffer.from(output.trim(), 'base64').toString('utf8'));
        if (result.ok !== true || !Array.isArray(result.documents)) throw new Error(`invalid 1C headless documents result: ${output}`);
        return result;
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

export async function countTopDocumentsFromExistingDesignerMetadata({ ssh, oneCConfiguration, oneCHeadlessQuery, remoteDirectory, remoteConfigurationXmlPath, top }) {
    return countTopDocumentsFromConfigurationXml({
        ssh,
        oneCConfiguration,
        oneCHeadlessQuery,
        remoteDirectory,
        remoteConfigurationXmlPath,
        top,
    });
}

export async function countTopDocumentsFromDesignerMetadata({ ssh, oneC, oneCConfiguration, oneCHeadlessQuery, remoteDirectory, top }) {
    // Восьми шестнадцатеричных символов достаточно для изолированного
    // short-lived dump и экономят десятки символов пути для Designer.
    const dumpDirectory = path.win32.join(oneCHeadlessQuery.guest.metadataDumpRootDirectory, randomUUID().replaceAll('-', '').slice(0, 8));
    const remoteConfigurationXmlPath = path.win32.join(dumpDirectory, oneCHeadlessQuery.guest.configurationXmlFilename);
    await executeGuestPowerShell(ssh, buildDumpScript(oneC, oneCConfiguration, oneCHeadlessQuery, dumpDirectory), 'dump 1C configuration metadata');
    const result = await countTopDocumentsFromConfigurationXml({
        ssh,
        oneCConfiguration,
        oneCHeadlessQuery,
        remoteDirectory,
        remoteConfigurationXmlPath,
        top,
    });
    await removeGuestDirectory(ssh, dumpDirectory);
    return result;
}
