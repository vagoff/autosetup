import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { hashFileSha256 } from '../lib/hash-file-sha256.js';

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
                    sha256: await hashFileSha256(filePath),
                });
            } else {
                throw new Error(`1C query runner source contains an unsupported entry: ${relativePath}`);
            }
        }
    }
    await visit('');
    return files;
}

// Исходники EPF -- обычные файлы нашего дерева (features/1c-query-runner/src/epf),
// поэтому "сборка" сводится к перечислению и хешированию: ничего не
// генерируется и ничего не патчится. Раньше этот модуль восстанавливал модуль
// формы из vendor/vanessa-runner подстановками по regexp -- см. инвариант
// OWNTHESOURCE о том, почему так больше нельзя.
export async function buildQueryRunnerStagedFiles(queryRunner, extraFiles) {
    return [
        ...await collectFiles(queryRunner.sourceDirectory),
        ...extraFiles.map((file) => ({ ...file, relativePath: file.filename })),
    ];
}

export function buildQueryRunnerLaunchParameter(args, remoteDirectory) {
    const resultPath = path.win32.join(remoteDirectory, 'result.json');
    // Имена параметров ASCII намеренно: управляющий канал не должен зависеть
    // от активной ANSI code page гостя. См. шапку Module.bsl.
    const templateParameters = `ResultFile=${resultPath};Exit`;
    if (args.mode === 'documents-top') return `Mode=documents-top;Top=${args.top};${templateParameters}`;
    if (args.mode === 'infobase-probe') return `Mode=infobase-probe;${templateParameters}`;
    if (args.mode === 'table-probe') return `Mode=table-probe;${templateParameters}`;
    if (args.mode === 'select-one') return `Mode=select-one;${templateParameters}`;
    return `Mode=query;QueryFile=${path.win32.join(remoteDirectory, 'query.txt')};MaxRows=${args.maxRows};${templateParameters}`;
}

export function parseQueryRunnerResult(resultText) {
    const envelope = JSON.parse(resultText);
    if (envelope.КодВозврата !== 0) throw new Error(`1C query runner failed: ${envelope.Ошибка || resultText}`);
    if (!Array.isArray(envelope.Сообщения) || envelope.Сообщения.length !== 1) {
        throw new Error(`1C query runner returned an invalid result envelope: ${resultText}`);
    }
    const result = JSON.parse(envelope.Сообщения[0]);
    if (result.ok !== true) throw new Error(`1C query runner failed: ${result.error || resultText}`);
    return result;
}
