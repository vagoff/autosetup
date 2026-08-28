import { quotePowerShell } from './execute-guest-powershell.js';

function matchingProcessesExpression() {
    return 'Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq "1cv8.exe" -or $_.Name -eq "1cv8c.exe") -and $_.CommandLine -and $_.CommandLine.IndexOf($stagingDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0 }';
}

export function buildReadOneCQueryRunnerScript(stagingDirectory) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$stagingDirectory = ${quotePowerShell(stagingDirectory)}`,
        `$matching = @(${matchingProcessesExpression()})`,
        '[ordered]@{ processIds = @($matching | ForEach-Object { $_.ProcessId }) } | ConvertTo-Json -Compress',
    ].join('\n');
}

export function buildStopOneCQueryRunnerScript(stagingDirectory, stopTimeoutSeconds) {
    if (!Number.isSafeInteger(stopTimeoutSeconds) || stopTimeoutSeconds < 1) {
        throw new Error('1C query runner stop timeout must be a positive integer');
    }
    return [
        '$ErrorActionPreference = "Stop"',
        `$stagingDirectory = ${quotePowerShell(stagingDirectory)}`,
        `$stopTimeoutSeconds = ${stopTimeoutSeconds}`,
        `$matching = @(${matchingProcessesExpression()})`,
        '$stopped = @()',
        'foreach ($process in $matching) {',
        '  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop',
        '  Wait-Process -Id $process.ProcessId -Timeout $stopTimeoutSeconds -ErrorAction SilentlyContinue',
        '  $stopped += $process.ProcessId',
        '}',
        '[ordered]@{ stoppedProcessIds = $stopped } | ConvertTo-Json -Compress',
    ].join('\n');
}
