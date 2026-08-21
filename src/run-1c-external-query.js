import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

function parseArguments(argv) {
    const mode = argv[0] === '--select-one' ? 'select-one' : argv[0] === '--documents-top' ? 'documents-top' : null;
    if (!mode) throw new Error('usage: node src/run-1c-external-query.js --select-one [--output file.json] | --documents-top N [--output file.json]');
    let index = 1;
    let top = null;
    if (mode === 'documents-top') {
        top = Number(argv[index]);
        if (!Number.isSafeInteger(top) || top < 1 || top > 1000) throw new Error('--documents-top requires an integer between 1 and 1000');
        index += 1;
    }
    let outputFilename = '1c-external-query-result.json';
    if (argv.length === index + 2 && argv[index] === '--output') outputFilename = argv[index + 1];
    else if (argv.length !== index) throw new Error('invalid external query arguments');
    if (path.basename(outputFilename) !== outputFilename) throw new Error('--output must be a filename, not a path');
    return { mode, top, outputFilename };
}

function buildSelectOneScript(database) {
    const connection = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connection)})`,
        "$query = $connection.NewObject('Query', 'ВЫБРАТЬ 1 КАК Значение')",
        '$selection = $query.Execute().Select()',
        "if (-not $selection.Next()) { throw 'SELECT 1 returned no row' }",
        '[ordered]@{ ok = $true; hasRow = $true; error = "" } | ConvertTo-Json -Compress',
    ].join('\n');
}

function buildDocumentsTopScript(database, top) {
    const connection = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connection)})`,
        `$top = ${top}`,
        '$documents = @()',
        '$metadataDocuments = $connection.Metadata.Documents',
        'for ($index = 0; $index -lt $metadataDocuments.Count(); $index += 1) {',
        '  $document = $metadataDocuments.Get($index)',
        '  $name = $document.Name',
        '  $query = $connection.NewObject("Query", "ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Количество ИЗ Документ.$name")',
        '  $selection = $query.Execute().Select()',
        '  if (-not $selection.Next()) { throw "COUNT returned no row for Document.$name" }',
        '  $documents += [pscustomobject]@{ name = [string]$name; synonym = [string]$document.Synonym; count = [int64]$selection.Количество }',
        '}',
        '$documents = @($documents | Sort-Object count -Descending | Select-Object -First $top)',
        '[ordered]@{ ok = $true; documents = $documents; error = "" } | ConvertTo-Json -Compress -Depth 4',
    ].join('\n');
}

export async function runOneCExternalQuery(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    const { oneCConfiguration, paths } = config;
    const script = args.mode === 'select-one'
        ? buildSelectOneScript(oneCConfiguration.database)
        : buildDocumentsTopScript(oneCConfiguration.database, args.top);
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, script, 'run 1C external query'));
    const result = JSON.parse(output);
    if (result.ok !== true || (args.mode === 'select-one' && result.hasRow !== true)) throw new Error(`invalid 1C external query result: ${output}`);
    await mkdir(paths.outputDir, { recursive: true });
    const outputPath = path.join(paths.outputDir, args.outputFilename);
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runOneCExternalQuery().catch((error) => { console.error(error.message); process.exit(1); });
