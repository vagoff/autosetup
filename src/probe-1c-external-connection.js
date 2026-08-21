import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { withGuestSession } from './lib/with-guest-session.js';

function buildProbeScript(oneCConfiguration) {
    const { database } = oneCConfiguration;
    const connectionString = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connectionString)})`,
        "$query = $connection.NewObject('Query', 'ВЫБРАТЬ 1 КАК Значение')",
        '$selection = $query.Execute().Select()',
        "if (-not $selection.Next()) { throw '1C external connection SELECT 1 returned no row' }",
        '[ordered]@{ ok = $true; hasRow = $true; error = "" } | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function probeOneCExternalConnection() {
    const { oneC, oneCConfiguration } = config;
    const output = await withGuestSession(async ({ ssh }) => {
        await assertOneCPlatformInstalled(ssh, oneC);
        return executeGuestPowerShell(ssh, buildProbeScript(oneCConfiguration), 'probe 1C external connection');
    });
    console.log(JSON.stringify(JSON.parse(output), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) probeOneCExternalConnection().catch((error) => { console.error(error.message); process.exit(1); });
