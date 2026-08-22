import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Читает только логи и staging неуспешного публикатора. Отдельный reader
// нужен, чтобы NOHIDEBUG не превращался в ручное SSH-исследование.
export function buildODataPublisherDiagnosticsScript(oneCOData) {
    const buildLog = `${oneCOData.guest.logDirectory}\\1c-odata-publisher-build.log`;
    const executionLog = `${oneCOData.guest.logDirectory}\\${oneCOData.guest.publicationLogFilename}`;
    return [
        '$ErrorActionPreference = "Stop"',
        `$paths = @(${quotePowerShell(buildLog)}, ${quotePowerShell(executionLog)})`,
        '$logs = @{}',
        'foreach ($path in $paths) { $logs[$path] = if (Test-Path -LiteralPath $path) { [IO.File]::ReadAllText($path) } else { "" } }',
        `$stagingRoot = ${quotePowerShell(oneCOData.guest.stagingDirectory)}`,
        '$staging = @(if (Test-Path -LiteralPath $stagingRoot) { Get-ChildItem -LiteralPath $stagingRoot -Directory | ForEach-Object { $_.FullName } } else { @() })',
        '$payload = [ordered]@{ logs = $logs; staging = $staging } | ConvertTo-Json -Depth 4 -Compress',
        '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))',
    ].join('\n');
}

export async function readOneCODataPublisherDiagnostics() {
    const { oneCOData } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, buildODataPublisherDiagnosticsScript(oneCOData), 'read OData publisher diagnostics'));
    console.log(Buffer.from(output.trim(), 'base64').toString('utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readOneCODataPublisherDiagnostics().catch((error) => { console.error(error.message); process.exit(1); });
}
