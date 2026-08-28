import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../../..');
const env = { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' };

// Скрипты пишут результат в output/<файл> И печатают его в stdout вперемешку
// с человекочитаемой строкой "... result: <путь>". Источник истины для теста
// -- файл, а не stdout: разбирать stdout пришлось бы regexp'ом по формату,
// который меняется независимо от самого результата.
async function readOutputJson(filename) {
    return JSON.parse(await readFile(path.join(projectRoot, 'output', filename), 'utf8'));
}

// Таймауты откалиброваны живым запуском на реальной production-копии ИБ, не
// придуманы: холодный тонкий клиент на большой ИБ стоит ~40с сам по себе
// (см. data/1c-query-runner.json5), а COM-соединение -- ~17с.
test('live external connection executes SELECT 1 through V83.COMConnector', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 60_000,
}, async () => {
    await execFileAsync(process.execPath, [
        'src/tools/run-1c-external-query.js', '--select-one', '--output', 'select-one.json',
    ], { cwd: projectRoot, env });
    assert.deepEqual(await readOutputJson('select-one.json'), {
        ok: true, columns: ['Значение'], rows: [{ Значение: 1 }], truncated: false, error: '',
    });
});

// Канонический инструмент подсчёта top-N документов -- run-1c-query.js
// --documents-top (сервер считает КОЛИЧЕСТВО по каждому типу документа сам,
// без выгрузки XML конфигурации). Более ранний вариант через
// /DumpConfigToFiles + поштучный COM COUNT по 333 типам документов этой ИБ
// снят: сама выгрузка конфигурации в XML занимает многие десятки минут, и
// это стоимость только чтобы ПОЛУЧИТЬ список типов, до единого COUNT.
test('live document census counts every document type on the server and ranks the top 10', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 180_000,
}, async () => {
    await execFileAsync(process.execPath, [
        'src/tools/run-1c-query.js', '--documents-top', '10', '--output', 'documents-top.json',
    ], { cwd: projectRoot, env });
    const result = await readOutputJson('documents-top.json');
    assert.equal(result.ok, true);
    assert.equal(result.documents.length, 10);
    for (let index = 1; index < result.documents.length; index += 1) {
        assert.ok(result.documents[index - 1].count >= result.documents[index].count, 'documents must be ranked by count, descending');
    }
});
