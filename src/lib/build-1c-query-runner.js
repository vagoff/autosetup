import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { hashFileSha256 } from './hash-file-sha256.js';

function sha256Text(sourceText) {
    return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

function replaceBusinessLogic(templateModule, businessLogic) {
    const region = /#Область БизнесЛогика\r?\n[\s\S]*?#КонецОбласти/u;
    if (!region.test(templateModule)) throw new Error('1C query runner template has no BusinessLogic region');
    return templateModule.replace(region, `#Область БизнесЛогика\n\n${businessLogic.trim()}\n\n#КонецОбласти`);
}

function makeResultWriterAtomic(templateModule) {
    const writer = /&НаСервереБезКонтекста\r?\nПроцедура ЗаписатьФайлРезультата\([\s\S]*?\r?\nКонецПроцедуры/u;
    if (!writer.test(templateModule)) throw new Error('1C query runner template has no result writer');
    return templateModule.replace(writer, [
        '&НаСервереБезКонтекста',
        'Процедура ЗаписатьФайлРезультата(Знач ПутьФайла, Знач Результат)',
        '',
        '    Если ПустаяСтрока(ПутьФайла) Тогда',
        '        Возврат;',
        '    КонецЕсли;',
        '',
        '    ВременныйФайл = ПутьФайла + ".tmp";',
        '    Попытка',
        '        Данные = Новый Структура;',
        '        Данные.Вставить("КодВозврата", Результат.КодВозврата);',
        '        Данные.Вставить("Сообщения", Результат.Сообщения);',
        '        Данные.Вставить("Ошибка", Результат.Ошибка);',
        '        ЗаписьJSON = Новый ЗаписьJSON;',
        '        ЗаписьJSON.ОткрытьФайл(ВременныйФайл, "UTF-8");',
        '        ЗаписатьJSON(ЗаписьJSON, Данные);',
        '        ЗаписьJSON.Закрыть();',
        '        ПереместитьФайл(ВременныйФайл, ПутьФайла);',
        '    Исключение',
        '        // Невозможность записать результат не должна оставить клиент открытым.',
        '    КонецПопытки;',
        '',
        'КонецПроцедуры',
    ].join('\n'));
}

function useAsciiLaunchParameters(templateModule) {
    const normalizedTemplate = templateModule.replaceAll('\r\n', '\n');
    const resultFileAssignment = [
        'Если ПараметрыЗапуска.Свойство("ФайлРезультата") Тогда',
        '\t\t\tПутьФайлаРезультата = ПараметрыЗапуска.ФайлРезультата;',
        '\t\tКонецЕсли;',
    ].join('\n');
    if (!normalizedTemplate.includes(resultFileAssignment)) throw new Error('1C query runner template has an unknown result-file parameter block');
    const withResultFile = normalizedTemplate.replace(resultFileAssignment, [
        'Если ПараметрыЗапуска.Свойство("ResultFile") Тогда',
        '\t\t\tПутьФайлаРезультата = ПараметрыЗапуска.ResultFile;',
        '\t\tКонецЕсли;',
    ].join('\n'));
    const exitFlag = 'ЗавершитьРаботуСистемыЗапрошено = ПараметрыЗапуска.Свойство("ЗавершитьРаботуСистемы");';
    if (!withResultFile.includes(exitFlag)) throw new Error('1C query runner template has an unknown exit parameter block');
    return withResultFile.replace(exitFlag, 'ЗавершитьРаботуСистемыЗапрошено = ПараметрыЗапуска.Свойство("Exit");');
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

// В XML-шаблоне Vanessa остаются форма и надёжная инфраструктура lifecycle.
// Feature заменяет только документированную область BusinessLogic, поэтому
// результат всегда записывается единым проверенным механизмом шаблона.
export async function buildQueryRunnerStagedFiles(queryRunner, extraFiles) {
    const sourceFiles = await collectFiles(queryRunner.templateSourceDirectory);
    const templateModule = sourceFiles.find((file) => file.relativePath === queryRunner.moduleRelativePath);
    if (!templateModule) throw new Error(`1C query runner template module is missing: ${queryRunner.moduleRelativePath}`);
    const businessLogicPath = path.join(queryRunner.sourceDirectory, queryRunner.featureBusinessLogicPath);
    const preparedTemplate = useAsciiLaunchParameters(makeResultWriterAtomic(
        await readFile(templateModule.filePath, 'utf8'),
    ));
    const moduleSourceText = replaceBusinessLogic(
        preparedTemplate,
        await readFile(businessLogicPath, 'utf8'),
    );
    const generatedModule = {
        relativePath: queryRunner.moduleRelativePath,
        sourceText: moduleSourceText,
        bytes: Buffer.byteLength(moduleSourceText, 'utf8'),
        sha256: sha256Text(moduleSourceText),
    };
    return [
        ...sourceFiles.filter((file) => file.relativePath !== queryRunner.moduleRelativePath),
        generatedModule,
        ...extraFiles.map((file) => ({ ...file, relativePath: file.filename })),
    ];
}

export function buildQueryRunnerLaunchParameter(args, remoteDirectory) {
    const resultPath = path.win32.join(remoteDirectory, 'result.json');
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
