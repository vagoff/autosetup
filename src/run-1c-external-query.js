import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { buildComQueryScript, parseComResult } from './lib/build-1c-com-query-script.js';
import { buildInfobasePresenceCheck } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { removeGuestDirectory } from './lib/stage-guest-files.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Запуск запроса к ИБ через внешнее соединение V83.COMConnector. В отличие от
// src/run-1c-query.js не собирает EPF и не поднимает клиент 1С с формой --
// поэтому быстрее, но требует зарегистрированного COM-коннектора
// (src/register-1c-com-connector.js).
function parseArguments(argv, queryRunner) {
    const result = { queryPath: null, maxRows: queryRunner.defaultMaxRows, outputFilename: '1c-external-query-result.json' };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${argument} requires a value`);
            return argv[index];
        };
        if (argument === '--query') {
            result.queryPath = path.resolve(next());
        } else if (argument === '--select-one') {
            result.selectOne = true;
        } else if (argument === '--max-rows') {
            result.maxRows = Number(next());
            if (!Number.isSafeInteger(result.maxRows) || result.maxRows < 1 || result.maxRows > queryRunner.maxMaxRows) {
                throw new Error(`--max-rows must be between 1 and ${queryRunner.maxMaxRows}`);
            }
        } else if (argument === '--output') {
            result.outputFilename = next();
            if (path.basename(result.outputFilename) !== result.outputFilename) throw new Error('--output must be a filename, not a path');
        } else {
            throw new Error(`unknown argument: ${argument}`);
        }
    }
    if (Boolean(result.queryPath) === Boolean(result.selectOne)) {
        throw new Error('usage: node src/run-1c-external-query.js (--query <file> | --select-one) [--max-rows N] [--output file.json]');
    }
    if (result.queryPath && !existsSync(result.queryPath)) throw new Error(`query file is missing: ${result.queryPath}`);
    return result;
}

export async function runOneCExternalQuery(argv = process.argv.slice(2)) {
    const { oneCConfiguration, oneCQueryRunner, paths } = config;
    const args = parseArguments(argv, oneCQueryRunner);
    const outputPath = path.join(paths.outputDir, args.outputFilename);

    const result = await withGuestSession(async ({ ssh }) => {
        await executeGuestPowerShell(
            ssh,
            `$ErrorActionPreference = 'Stop'\n${buildInfobasePresenceCheck(oneCConfiguration, 'run 1C external query')}`,
            'check 1C external query infobase',
        );
        const remoteDirectory = path.win32.join(oneCQueryRunner.guest.stagingDirectory, randomUUID());
        const remoteQueryPath = path.win32.join(remoteDirectory, 'query.txt');
        await executeGuestPowerShell(
            ssh,
            `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
            'create 1C external query staging directory',
        );
        try {
            // SELECT 1 -- та же дорога, что и произвольный запрос, просто с
            // заранее известным текстом. Отдельной реализации не существует.
            if (args.selectOne) {
                await executeGuestPowerShell(
                    ssh,
                    `$ErrorActionPreference = 'Stop'; [IO.File]::WriteAllText(${quotePowerShell(remoteQueryPath)}, ${quotePowerShell('ВЫБРАТЬ 1 КАК Значение')}, (New-Object Text.UTF8Encoding $false))`,
                    'write 1C external select-one query',
                );
            } else {
                await ssh.putFile(args.queryPath, remoteQueryPath);
            }
            const output = await executeGuestPowerShell(
                ssh,
                buildComQueryScript(oneCConfiguration, { queryPath: remoteQueryPath, maxRows: args.maxRows }),
                'run 1C external query',
            );
            const parsed = parseComResult(output);
            if (parsed.ok !== true) throw new Error(`invalid 1C external query result: ${output}`);
            await removeGuestDirectory(ssh, remoteDirectory);
            return parsed;
        } catch (error) {
            // Staging остаётся при ошибке -- NOHIDEBUG, текст запроса нужен для разбора.
            throw error;
        }
    });

    await mkdir(paths.outputDir, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    console.log(`1C external query result: ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runOneCExternalQuery().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
