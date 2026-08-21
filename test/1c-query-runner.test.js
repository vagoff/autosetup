import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSON5 from 'json5';
import { buildQueryRunnerLaunchParameter, buildQueryRunnerStagedFiles, parseQueryRunnerResult } from '../src/lib/build-1c-query-runner.js';
import { buildReadOneCQueryRunnerScript, buildStopOneCQueryRunnerScript } from '../src/lib/build-stop-1c-query-runner-script.js';

test('query runner replaces only the Vanessa template BusinessLogic region', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autosetup-query-runner-'));
    const templateDirectory = path.join(root, 'template');
    const moduleRelativePath = path.join('Template', 'Module.bsl');
    await mkdir(path.join(templateDirectory, 'Template'), { recursive: true });
    await writeFile(path.join(templateDirectory, 'Template.xml'), '<template/>');
    await writeFile(path.join(templateDirectory, moduleRelativePath), [
        'before',
        '&НаСервереБезКонтекста',
        'Процедура ЗаписатьФайлРезультата(Знач ПутьФайла, Знач Результат)',
        'КонецПроцедуры',
        'Если ПараметрыЗапуска.Свойство("ФайлРезультата") Тогда',
        '\t\t\tПутьФайлаРезультата = ПараметрыЗапуска.ФайлРезультата;',
        '\t\tКонецЕсли;',
        'ЗавершитьРаботуСистемыЗапрошено = ПараметрыЗапуска.Свойство("ЗавершитьРаботуСистемы");',
        '#Область БизнесЛогика',
        'template operation',
        '#КонецОбласти',
        'after',
    ].join('\n'));
    const featureDirectory = path.join(root, 'feature');
    await mkdir(path.join(featureDirectory, 'Feature'), { recursive: true });
    await writeFile(path.join(featureDirectory, 'Feature', 'BusinessLogic.bsl'), 'feature operation');

    const files = await buildQueryRunnerStagedFiles({
        templateSourceDirectory: templateDirectory,
        sourceDirectory: featureDirectory,
        moduleRelativePath,
        featureBusinessLogicPath: path.join('Feature', 'BusinessLogic.bsl'),
    }, []);

    assert.deepEqual(files.map((file) => file.relativePath).sort(), ['Template.xml', moduleRelativePath].sort());
    const source = files.find((file) => file.relativePath === moduleRelativePath).sourceText;
    assert.match(source, /#Область БизнесЛогика\n\nfeature operation\n\n#КонецОбласти/u);
    assert.doesNotMatch(source, /template operation/u);
    assert.ok(source.startsWith('before\n'));
    assert.match(source, /\nafter$/u);
});

test('documents-top launches the documents census rather than the temporary baseline', () => {
    assert.equal(
        buildQueryRunnerLaunchParameter({ mode: 'documents-top', top: 10 }, 'C:\\staging\\run'),
        'Mode=documents-top;Top=10;ResultFile=C:\\staging\\run\\result.json;Exit',
    );
});

test('infobase probe requests configuration-specific metadata without a table scan', () => {
    assert.equal(
        buildQueryRunnerLaunchParameter({ mode: 'infobase-probe' }, 'C:\\staging\\run'),
        'Mode=infobase-probe;ResultFile=C:\\staging\\run\\result.json;Exit',
    );
});

test('select-one is the first SQL execution gate', () => {
    assert.equal(
        buildQueryRunnerLaunchParameter({ mode: 'select-one' }, 'C:\\staging\\run'),
        'Mode=select-one;ResultFile=C:\\staging\\run\\result.json;Exit',
    );
});

test('table probe performs a bounded domain-table read', () => {
    assert.equal(
        buildQueryRunnerLaunchParameter({ mode: 'table-probe' }, 'C:\\staging\\run'),
        'Mode=table-probe;ResultFile=C:\\staging\\run\\result.json;Exit',
    );
});

test('query runner uses the configured thin client for unattended EPF execution', async () => {
    const source = await readFile(new URL('../src/run-1c-query.js', import.meta.url), 'utf8');
    assert.match(source, /oneC\.thinClientExecutablePath,/u);
    assert.doesNotMatch(source, /oneCQueryRunner\.enterpriseExecutablePath/u);
});

test('query runner gives probes a 10-second limit without shortening the document census', async () => {
    const configPath = new URL('../data/1c-query-runner.json5', import.meta.url);
    const queryRunner = JSON5.parse(await readFile(configPath, 'utf8'));
    assert.equal(queryRunner.probeTimeoutSeconds, 10);
    assert.ok(queryRunner.documentsTopTimeoutSeconds > queryRunner.probeTimeoutSeconds);
    assert.ok(queryRunner.queryTimeoutSeconds > queryRunner.probeTimeoutSeconds);
});

test('query runner business logic returns data through the template result envelope', async () => {
    const modulePath = new URL('../features/1c-query-runner/src/QueryRunner/BusinessLogic.bsl', import.meta.url);
    const source = await readFile(modulePath, 'utf8');
    assert.match(source, /Функция ВыполнитьОперацию/u);
    assert.match(source, /Результат\.Сообщения\.Добавить/u);
    assert.doesNotMatch(source, /ЗаписьТекста|ПереместитьФайл/u);
    assert.doesNotMatch(source, /Наконец/u);
});

test('query runner decodes the Vanessa result envelope', () => {
    const result = parseQueryRunnerResult(JSON.stringify({
        КодВозврата: 0,
        Сообщения: [JSON.stringify({ ok: true, documents: [{ name: 'Заказ', count: 1 }], error: '' })],
        Ошибка: '',
    }));
    assert.deepEqual(result.documents, [{ name: 'Заказ', count: 1 }]);
});

test('query-runner stop script is limited to its configured staging directory', () => {
    const script = buildStopOneCQueryRunnerScript('C:\\ProgramData\\AutoSetup\\staging\\1c-query-runner', 30);
    assert.match(script, /\$_.CommandLine\.IndexOf\(\$stagingDirectory/u);
    assert.match(script, /\(\$_\.Name -eq "1cv8\.exe" -or \$_\.Name -eq "1cv8c\.exe"\)/u);
    assert.match(script, /Wait-Process -Id \$process\.ProcessId/u);
    assert.doesNotMatch(script, /Get-Process\s*\|\s*Stop-Process/u);
    assert.match(buildReadOneCQueryRunnerScript('C:\\ProgramData\\AutoSetup\\staging\\1c-query-runner'), /processIds/u);
});

test('query runner publishes the result atomically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autosetup-query-runner-atomic-'));
    const templateDirectory = path.join(root, 'template');
    const moduleRelativePath = path.join('Template', 'Module.bsl');
    await mkdir(path.join(templateDirectory, 'Template'), { recursive: true });
    await writeFile(path.join(templateDirectory, 'Template.xml'), '<template/>');
    await writeFile(path.join(templateDirectory, moduleRelativePath), [
        '&НаСервереБезКонтекста',
        'Процедура ЗаписатьФайлРезультата(Знач ПутьФайла, Знач Результат)',
        'КонецПроцедуры',
        'Если ПараметрыЗапуска.Свойство("ФайлРезультата") Тогда',
        '\t\t\tПутьФайлаРезультата = ПараметрыЗапуска.ФайлРезультата;',
        '\t\tКонецЕсли;',
        'ЗавершитьРаботуСистемыЗапрошено = ПараметрыЗапуска.Свойство("ЗавершитьРаботуСистемы");',
        '#Область БизнесЛогика',
        'template operation',
        '#КонецОбласти',
    ].join('\n'));
    const featureDirectory = path.join(root, 'feature');
    await mkdir(featureDirectory, { recursive: true });
    await writeFile(path.join(featureDirectory, 'BusinessLogic.bsl'), 'feature operation');
    const files = await buildQueryRunnerStagedFiles({
        templateSourceDirectory: templateDirectory,
        sourceDirectory: featureDirectory,
        moduleRelativePath,
        featureBusinessLogicPath: 'BusinessLogic.bsl',
    }, []);
    const source = files.find((file) => file.relativePath === moduleRelativePath).sourceText;
    assert.match(source, /ВременныйФайл = ПутьФайла \+ "\.tmp"/u);
    assert.match(source, /ПереместитьФайл\(ВременныйФайл, ПутьФайла\)/u);
    assert.match(source, /ПараметрыЗапуска\.Свойство\("ResultFile"\)/u);
    assert.match(source, /ПараметрыЗапуска\.Свойство\("Exit"\)/u);
});

test('guest runner precreates only the atomic temporary result file', async () => {
    const scriptPath = new URL('../src/guest-scripts/run-1c-query.ps1', import.meta.url);
    const source = await readFile(scriptPath, 'utf8');
    assert.match(source, /New-Item -ItemType File -Path \(\$ResultPath \+ '\.tmp'\) -Force/u);
});
