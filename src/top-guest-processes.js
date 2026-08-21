import { withGuestSession } from './lib/with-guest-session.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';

function parseLimit(argv) {
    if (argv.length === 0) return 10;
    if (argv.length !== 2 || argv[0] !== '--limit' || !/^\d+$/u.test(argv[1])) {
        throw new Error('usage: node src/top-guest-processes.js [--limit N]');
    }
    const limit = Number(argv[1]);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be between 1 and 100');
    return limit;
}

function buildTopScript(limit) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$limit = ${limit}`,
        '$cores = [Environment]::ProcessorCount',
        '$before = @{}',
        'Get-Process | ForEach-Object { $before[$_.Id] = [double]$_.CPU }',
        '$started = [DateTime]::UtcNow',
        'Start-Sleep -Seconds 1',
        '$elapsed = ([DateTime]::UtcNow - $started).TotalSeconds',
        '$top = @(Get-Process | ForEach-Object {',
        '  $previousCpu = if ($before.ContainsKey($_.Id)) { $before[$_.Id] } else { [double]$_.CPU }',
        '  [pscustomobject]@{',
        '    pid = $_.Id',
        '    name = $_.ProcessName',
        '    cpuPercent = [Math]::Round((([double]$_.CPU - $previousCpu) / $elapsed / $cores) * 100, 1)',
        '    cpuSeconds = [Math]::Round([double]$_.CPU, 3)',
        '    workingSetMiB = [Math]::Round($_.WorkingSet64 / 1MB, 1)',
        '  }',
        '} | Sort-Object cpuPercent, workingSetMiB -Descending | Select-Object -First $limit)',
        '$queryRunner = @(Get-CimInstance Win32_Process | Where-Object {',
        '  ($_.Name -eq "1cv8.exe" -or $_.Name -eq "1cv8c.exe") -and $_.CommandLine -and $_.CommandLine.IndexOf("\\staging\\1c-query-runner\\", [StringComparison]::OrdinalIgnoreCase) -ge 0',
        '} | Select-Object ProcessId,Name,CommandLine)',
        '[ordered]@{ sampledSeconds = [Math]::Round($elapsed, 3); logicalProcessors = $cores; top = $top; queryRunner = $queryRunner } | ConvertTo-Json -Depth 4',
    ].join('\n');
}

export async function topGuestProcesses(argv = process.argv.slice(2)) {
    const limit = parseLimit(argv);
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, buildTopScript(limit), 'sample guest processes'));
    console.log(JSON.stringify(JSON.parse(output), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    topGuestProcesses().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
