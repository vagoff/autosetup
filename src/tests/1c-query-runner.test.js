import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSON5 from 'json5';
import { buildQueryRunnerLaunchParameter, buildQueryRunnerStagedFiles, parseQueryRunnerResult } from '../infrastructure/build-1c-query-runner.js';
import { buildReadOneCQueryRunnerScript, buildStopOneCQueryRunnerScript } from '../infrastructure/build-stop-1c-query-runner-script.js';

test('query runner stages the EPF source tree verbatim and appends extra files under their filename', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autosetup-query-runner-'));
    await mkdir(path.join(root, 'ШаблонОбработки'), { recursive: true });
    await writeFile(path.join(root, 'ШаблонОбработки.xml'), '<template/>');
    await writeFile(path.join(root, 'ШаблонОбработки', 'Module.bsl'), 'business logic');
    const queryPath = path.join(root, '..', 'unrelated.query');
    await writeFile(queryPath, 'stored outside the EPF source tree, on purpose');

    const files = await buildQueryRunnerStagedFiles({ sourceDirectory: root }, [
        { filePath: queryPath, filename: 'query.txt', bytes: 6, sha256: 'deadbeef' },
    ]);

    assert.deepEqual(files.map((file) => file.relativePath).sort(), [
        'ШаблонОбработки.xml',
        path.join('ШаблонОбработки', 'Module.bsl'),
        'query.txt',
    ].sort());
    const extra = files.find((file) => file.relativePath === 'query.txt');
    assert.equal(extra.bytes, 6);
    assert.equal(extra.sha256, 'deadbeef');
    const staged = files.find((file) => file.relativePath === path.join('ШаблонОбработки', 'Module.bsl'));
    assert.equal(staged.filePath, path.join(root, 'ШаблонОбработки', 'Module.bsl'));
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
    const source = await readFile(new URL('../tools/run-1c-query.js', import.meta.url), 'utf8');
    assert.match(source, /oneC\.thinClientExecutablePath,/u);
    assert.doesNotMatch(source, /oneCQueryRunner\.enterpriseExecutablePath/u);
});

test('query runner gives the document census and arbitrary queries more room than a bare probe', async () => {
    const configPath = new URL('../../data/1c-query-runner.json5', import.meta.url);
    const queryRunner = JSON5.parse(await readFile(configPath, 'utf8'));
    // probeTimeoutSeconds измерен живым запуском: холодный тонкий клиент на
    // production-копии ИБ стоит ~40с ещё до выполнения запроса -- не 10с.
    assert.ok(queryRunner.probeTimeoutSeconds >= 60);
    assert.ok(queryRunner.documentsTopTimeoutSeconds >= queryRunner.probeTimeoutSeconds);
    assert.ok(queryRunner.queryTimeoutSeconds >= queryRunner.probeTimeoutSeconds);
});

test('epf business logic dispatches every runner mode and returns data through the message envelope', async () => {
    const modulePath = new URL('../../features/1c-query-runner/src/epf/ШаблонОбработки/Forms/Форма/Ext/Form/Module.bsl', import.meta.url);
    const source = await readFile(modulePath, 'utf8');
    assert.match(source, /Функция ВыполнитьОперацию/u);
    assert.match(source, /Результат\.Сообщения\.Добавить\(СериализоватьJSON\(Данные\)\)/u);
    for (const mode of ['query', 'documents-top', 'infobase-probe', 'table-probe', 'select-one']) {
        assert.match(source, new RegExp(`Режим = "${mode}"`, 'u'));
    }
});

test('epf business logic publishes the result file atomically using ASCII launch parameters', async () => {
    const modulePath = new URL('../../features/1c-query-runner/src/epf/ШаблонОбработки/Forms/Форма/Ext/Form/Module.bsl', import.meta.url);
    const source = await readFile(modulePath, 'utf8');
    assert.match(source, /ВременныйФайл = ПутьФайла \+ "\.tmp"/u);
    assert.match(source, /ПереместитьФайл\(ВременныйФайл, ПутьФайла\)/u);
    assert.match(source, /ПараметрыЗапуска\.Свойство\("ResultFile"\)/u);
    assert.match(source, /ПараметрыЗапуска\.Свойство\("Exit"\)/u);
    // Управляющий канал не должен зависеть от активной ANSI code page гостя
    // (см. шапку файла) -- параметры запуска не кириллические.
    assert.doesNotMatch(source, /Свойство\("ФайлРезультата"\)|Свойство\("ЗавершитьРаботуСистемы"\)/u);
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

test('guest runner precreates only the atomic temporary result file', async () => {
    const scriptPath = new URL('../infrastructure/guest-scripts/run-1c-epf.ps1', import.meta.url);
    const source = await readFile(scriptPath, 'utf8');
    assert.match(source, /New-Item -ItemType File -Path \(\$ResultPath \+ '\.tmp'\) -Force/u);
});
