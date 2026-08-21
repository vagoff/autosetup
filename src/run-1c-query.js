import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { buildEnterpriseArguments, buildInfobasePresenceCheck, buildWindowsArgumentLine } from './lib/execute-1c.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { executeGuestPowerShellFile } from './lib/execute-guest-powershell-file.js';
import { assertOneCPlatformInstalled } from './lib/read-1c-platform-state.js';
import { removeGuestDirectory } from './lib/stage-guest-files.js';
import { withGuestSession } from './lib/with-guest-session.js';

async function sha256(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function collectFiles(rootDirectory) {
    const files = [];
    async function visit(relativeDirectory) {
        const absoluteDirectory = path.join(rootDirectory, relativeDirectory);
        for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) {
                await visit(relativePath);
            } else if (entry.isFile()) {
                const filePath = path.join(rootDirectory, relativePath);
                files.push({
                    filePath,
                    relativePath,
                    bytes: (await stat(filePath)).size,
                    sha256: await sha256(filePath),
                });
            } else {
                throw new Error(`1C query runner source contains an unsupported entry: ${relativePath}`);
            }
        }
    }
    await visit('');
    return files;
}

function assertLocalSources(queryRunner) {
    const rootXmlPath = path.join(queryRunner.templateSourceDirectory, queryRunner.rootXmlFilename);
    if (!existsSync(rootXmlPath)) throw new Error(`1C query runner root XML is missing: ${rootXmlPath}`);
    const modulePath = path.join(queryRunner.sourceDirectory, queryRunner.featureModulePath);
    if (!existsSync(modulePath)) throw new Error(`1C query runner module is missing: ${modulePath}`);
    return rootXmlPath;
}

async function stageSourceTree(ssh, queryRunner, extraFiles) {
    const sourceFiles = (await collectFiles(queryRunner.templateSourceDirectory))
        .filter((file) => file.relativePath !== queryRunner.moduleRelativePath);
    const featureModulePath = path.join(queryRunner.sourceDirectory, queryRunner.featureModulePath);
    const featureModule = {
        filePath: featureModulePath,
        relativePath: queryRunner.moduleRelativePath,
        bytes: (await stat(featureModulePath)).size,
        sha256: await sha256(featureModulePath),
    };
    const remoteDirectory = path.win32.join(queryRunner.guest.stagingDirectory, randomUUID());
    const remoteSourceDirectory = path.win32.join(remoteDirectory, 'source');
    const stagedFiles = [
        ...[...sourceFiles, featureModule].map((file) => ({ ...file, remotePath: path.win32.join(remoteSourceDirectory, file.relativePath) })),
        ...extraFiles.map((file) => ({ ...file, relativePath: file.filename, remotePath: path.win32.join(remoteDirectory, file.filename) })),
    ];

    await executeGuestPowerShell(
        ssh,
        `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteSourceDirectory)} -Force | Out-Null`,
        'create 1C query runner staging directory',
    );
    try {
        for (const file of stagedFiles) {
            await executeGuestPowerShell(
                ssh,
                `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(path.win32.dirname(file.remotePath))} -Force | Out-Null`,
                `create staging parent for ${file.relativePath}`,
            );
            await ssh.putFile(file.filePath, file.remotePath);
        }
        const manifest = stagedFiles.map((file) => (
            `[pscustomobject]@{ Path = ${quotePowerShell(file.remotePath)}; Bytes = ${file.bytes}; Sha256 = ${quotePowerShell(file.sha256)} }`
        )).join(',\n');
        await executeGuestPowerShell(ssh, [
            '$ErrorActionPreference = "Stop"',
            `$files = @(${manifest})`,
            'foreach ($file in $files) {',
            '  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) { throw "staged file is missing: $($file.Path)" }',
            '  if ((Get-Item -LiteralPath $file.Path).Length -ne $file.Bytes) { throw "staged file size mismatch: $($file.Path)" }',
            '  $actual = (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash.ToLowerInvariant()',
            '  if ($actual -ne $file.Sha256) { throw "staged file SHA-256 mismatch: $($file.Path)" }',
            '}',
        ].join('\n'), 'verify 1C query runner staging');
        return { remoteDirectory, remoteSourceDirectory };
    } catch (error) {
        await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        throw error;
    }
}

function buildDesignerCommandArguments(infobaseDirectory, operationArguments, logPath) {
    return [
        'DESIGNER',
        '/F', infobaseDirectory,
        '/DisableStartupMessages',
        '/DisableStartupDialogs',
        '/Out', logPath,
        ...operationArguments,
    ];
}

function buildRunnerArguments(oneCConfiguration, queryRunner, paths, launchParameter) {
    const compilerInfobase = path.win32.join(paths.remoteDirectory, 'compiler-infobase');
    const rootXml = path.win32.join(paths.remoteSourceDirectory, queryRunner.rootXmlFilename);
    const epfPath = path.win32.join(paths.remoteDirectory, 'query-runner.epf');
    const resultPath = path.win32.join(paths.remoteDirectory, 'result.json');
    const buildLogPath = path.win32.join(queryRunner.guest.logDirectory, queryRunner.guest.buildLogFilename);
    const executionLogPath = path.win32.join(queryRunner.guest.logDirectory, queryRunner.guest.executionLogFilename);
    const enterpriseArguments = buildEnterpriseArguments(oneCConfiguration, [
        '/Execute', epfPath,
        '/Out', executionLogPath,
        '/L', oneCConfiguration.database.languageCode,
    ]);

    return {
        compilerInfobase,
        epfPath,
        resultPath,
        buildLogPath,
        executionLogPath,
        buildEpfArguments: buildWindowsArgumentLine(buildDesignerCommandArguments(
            compilerInfobase,
            ['/LoadExternalDataProcessorOrReportFromFiles', rootXml, epfPath],
            buildLogPath,
        )),
        // /C — один параметр платформы, а не ключ со следующим argv. Не
        // пропускаем его через quoteWindowsCommandLineArgument(), потому что
        // самой платформе требуются именно внутренние двойные кавычки.
        runEpfArguments: `${buildWindowsArgumentLine(enterpriseArguments)} /C"${launchParameter}"`,
    };
}

function parsePositiveInteger(value, name, max) {
    if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${name} must be between 1 and ${max}`);
    return parsed;
}

function parseArguments(argv, queryRunner) {
    const result = { mode: null, queryPath: null, maxRows: queryRunner.defaultMaxRows, top: 10, outputFilename: '1c-query-result.json' };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${argument} requires a value`);
            return argv[index];
        };
        if (argument === '--query') {
            if (result.mode) throw new Error('choose exactly one of --query or --documents-top');
            result.mode = 'query';
            result.queryPath = path.resolve(next());
        } else if (argument === '--documents-top') {
            if (result.mode) throw new Error('choose exactly one of --query or --documents-top');
            result.mode = 'documents-top';
            result.top = parsePositiveInteger(next(), '--documents-top', queryRunner.maxMaxRows);
        } else if (argument === '--max-rows') {
            result.maxRows = parsePositiveInteger(next(), '--max-rows', queryRunner.maxMaxRows);
        } else if (argument === '--output') {
            result.outputFilename = next();
            if (path.basename(result.outputFilename) !== result.outputFilename) throw new Error('--output must be a filename, not a path');
        } else {
            throw new Error(`unknown argument: ${argument}`);
        }
    }
    if (!result.mode) throw new Error('usage: node src/run-1c-query.js --query <file> [--max-rows N] [--output file.json] | --documents-top <N> [--output file.json]');
    if (result.mode === 'query' && !existsSync(result.queryPath)) throw new Error(`query file is missing: ${result.queryPath}`);
    return result;
}

async function buildExtraFiles(args) {
    if (args.mode !== 'query') return [];
    return [{
        filePath: args.queryPath,
        filename: 'query.txt',
        bytes: (await stat(args.queryPath)).size,
        sha256: await sha256(args.queryPath),
    }];
}

function buildLaunchParameter(args, remoteDirectory) {
    const resultPath = path.win32.join(remoteDirectory, 'result.json');
    if (args.mode === 'documents-top') return `Mode=documents-top;ResultFile=${resultPath};Top=${args.top}`;
    return `Mode=query;QueryFile=${path.win32.join(remoteDirectory, 'query.txt')};ResultFile=${resultPath};MaxRows=${args.maxRows}`;
}

export async function runOneCQuery(argv = process.argv.slice(2)) {
    const { oneC, oneCConfiguration, oneCQueryRunner, paths } = config;
    const args = parseArguments(argv, oneCQueryRunner);
    assertLocalSources(oneCQueryRunner);
    const extraFiles = await buildExtraFiles(args);
    const outputPath = path.join(paths.outputDir, args.outputFilename);

    await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        await executeGuestPowerShell(
            session.ssh,
            `$ErrorActionPreference = 'Stop'\n${buildInfobasePresenceCheck(oneCConfiguration, 'run 1C query')}`,
            'check 1C query infobase',
        );
        const staged = await stageSourceTree(session.ssh, oneCQueryRunner, extraFiles);
        let succeeded = false;
        try {
            const runner = buildRunnerArguments(oneCConfiguration, oneCQueryRunner, staged, buildLaunchParameter(args, staged.remoteDirectory));
            const output = await executeGuestPowerShellFile(session.ssh, {
                localPath: path.join(paths.guestScriptsDir, 'run-1c-query.ps1'),
                remotePath: path.win32.join(staged.remoteDirectory, 'run-1c-query.ps1'),
                argumentsList: [
                    oneC.clientExecutablePath,
                    oneC.thinClientExecutablePath,
                    runner.compilerInfobase,
                    runner.epfPath,
                    runner.resultPath,
                    runner.buildLogPath,
                    runner.executionLogPath,
                    oneCQueryRunner.timeoutSeconds,
                    runner.buildEpfArguments,
                    runner.runEpfArguments,
                ],
                label: 'run 1C query runner',
            });
            const resultText = Buffer.from(output.trim(), 'base64').toString('utf8');
            const result = JSON.parse(resultText);
            await mkdir(paths.outputDir, { recursive: true });
            await writeFile(outputPath, resultText, 'utf8');
            if (result.ok !== true) throw new Error(`1C query runner failed: ${result.error || resultText}`);
            succeeded = true;
            console.log(JSON.stringify(result, null, 2));
        } finally {
            if (succeeded) await removeGuestDirectory(session.ssh, staged.remoteDirectory);
        }
    });
    console.log(`1C query result: ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runOneCQuery().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
