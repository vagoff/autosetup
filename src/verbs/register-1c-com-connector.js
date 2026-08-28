import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { withGuestSession } from './lib/with-guest-session.js';

function buildRegisterScript(comConnectorPath) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$dllPath = ${quotePowerShell(comConnectorPath)}`,
        'if (-not (Test-Path -LiteralPath $dllPath -PathType Leaf)) { throw "1C COM connector DLL is missing: $dllPath" }',
        '$platformDirectory = Split-Path -Parent $dllPath',
        '$regsvr32 = Join-Path $env:SystemRoot "System32\\regsvr32.exe"',
        '$previousPath = $env:PATH',
        'try {',
        '  $env:PATH = "$platformDirectory;$env:PATH"',
        '  $registration = Start-Process -FilePath $regsvr32 -WorkingDirectory $platformDirectory -ArgumentList (\'/s "\' + $dllPath + \'"\') -Wait -PassThru',
        '} finally {',
        '  $env:PATH = $previousPath',
        '}',
        'if ($registration.ExitCode -ne 0) { throw "register 1C COM connector failed: $($registration.ExitCode)" }',
        '$connector = New-Object -ComObject "V83.COMConnector"',
        'if ($null -eq $connector) { throw "1C COM connector was not created" }',
        '[ordered]@{ ok = $true; progId = "V83.COMConnector" } | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function registerOneCComConnector() {
    const { oneC } = config;
    const output = await withGuestSession(async ({ ssh }) => {
        await assertOneCPlatformInstalled(ssh, oneC);
        return executeGuestPowerShell(ssh, buildRegisterScript(oneC.comConnectorPath), 'register 1C COM connector');
    });
    const result = JSON.parse(output);
    if (result.ok !== true) throw new Error(`invalid 1C COM connector result: ${output}`);
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    registerOneCComConnector().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
