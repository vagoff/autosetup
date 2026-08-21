import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { buildComQueryScript } from './lib/build-1c-com-query-script.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory } from './lib/stage-guest-files.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Одно проверяемое действие: внешнее соединение с ИБ через V83.COMConnector
// живо и отвечает на тривиальный запрос. Сам запрос строится тем же
// build-1c-com-query-script.js, что и произвольные запросы, -- второй копии
// этого PowerShell не существует.
export async function probeOneCExternalConnection() {
    const { oneC, oneCConfiguration, oneCQueryRunner } = config;
    const output = await withGuestSession(async ({ ssh }) => {
        await assertOneCPlatformInstalled(ssh, oneC);
        const remoteDirectory = path.win32.join(oneCQueryRunner.guest.stagingDirectory, randomUUID());
        const remoteQueryPath = path.win32.join(remoteDirectory, 'query.txt');
        await executeGuestPowerShell(ssh, [
            "$ErrorActionPreference = 'Stop'",
            `New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
            `[IO.File]::WriteAllText(${quotePowerShell(remoteQueryPath)}, ${quotePowerShell('ВЫБРАТЬ 1 КАК Значение')}, (New-Object Text.UTF8Encoding $false))`,
        ].join('\n'), 'stage 1C external connection probe query');
        const result = await executeGuestPowerShell(
            ssh,
            buildComQueryScript(oneCConfiguration, { queryPath: remoteQueryPath, maxRows: 1 }),
            'probe 1C external connection',
        );
        await removeGuestDirectory(ssh, remoteDirectory);
        return result;
    });
    const parsed = JSON.parse(output);
    if (parsed.ok !== true || parsed.rows.length !== 1) {
        throw new Error(`1C external connection probe returned no row: ${output}`);
    }
    console.log(JSON.stringify(parsed, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    probeOneCExternalConnection().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
