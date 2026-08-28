import { config } from './config.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

function parsePositiveInteger(value, option, maximum) {
    if (!/^\d+$/u.test(value)) throw new Error(`${option} must be an integer between 1 and ${maximum}`);
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`${option} must be an integer between 1 and ${maximum}`);
    return result;
}

function parseArguments(argv, guestDiskWriters) {
    const result = { limit: guestDiskWriters.defaultWriterLimit, seconds: guestDiskWriters.writeSampleSeconds };
    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        index += 1;
        if (index >= argv.length) throw new Error(`${option} requires a value`);
        if (option === '--limit') result.limit = parsePositiveInteger(argv[index], '--limit', guestDiskWriters.maxWriterLimit);
        else if (option === '--seconds') result.seconds = parsePositiveInteger(argv[index], '--seconds', guestDiskWriters.maxWriteSampleSeconds);
        else throw new Error('usage: node src/top-guest-disk-writers.js [--limit N] [--seconds N]');
    }
    return result;
}

function buildTopGuestDiskWritersScript(sampleSeconds, limit) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$sampleSeconds = ${sampleSeconds}`,
        `$limit = ${limit}`,
        '$before = @{}',
        // Get-Process.IOWriteBytes в Windows 11 может оставаться нулём для
        // части процессов. Win32_Process.WriteTransferCount — тот же
        // системный счётчик, который обновляет диспетчер процессов.
        'Get-CimInstance Win32_Process | ForEach-Object { $before[$_.ProcessId] = [uint64]$_.WriteTransferCount }',
        '$started = [DateTime]::UtcNow',
        'Start-Sleep -Seconds $sampleSeconds',
        '$elapsed = ([DateTime]::UtcNow - $started).TotalSeconds',
        '$writers = @(Get-CimInstance Win32_Process | ForEach-Object {',
        '  $current = [uint64]$_.WriteTransferCount',
        '  $previous = if ($before.ContainsKey($_.ProcessId)) { $before[$_.ProcessId] } else { $current }',
        '  $written = [int64]($current - $previous)',
        '  [pscustomobject]@{',
        '    pid = $_.ProcessId',
        '    name = $_.Name',
        '    writeBytes = $written',
        '    writeMiBPerSecond = [Math]::Round(($written / 1MB) / $elapsed, 3)',
        '  }',
        '} | Where-Object { $_.writeBytes -gt 0 } | Sort-Object writeBytes -Descending | Select-Object -First $limit)',
        '[ordered]@{ sampledSeconds = [Math]::Round($elapsed, 3); writers = $writers } | ConvertTo-Json -Depth 4',
    ].join('\n');
}

export async function topGuestDiskWriters(argv = process.argv.slice(2)) {
    const guestDiskWriters = config.diagnostics.guestDiskWriters;
    const args = parseArguments(argv, guestDiskWriters);
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, buildTopGuestDiskWritersScript(args.seconds, args.limit), 'sample guest disk writers'));
    console.log(JSON.stringify(JSON.parse(output), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) topGuestDiskWriters().catch((error) => { console.error(error.message); process.exit(1); });
