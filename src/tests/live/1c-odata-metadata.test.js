import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../../..');
const env = { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' };
const enabled = process.env.AUTOSETUP_LIVE_TESTS === '1';

test('read-1c-odata-metadata dumps every published document with its tabular sections', { skip: !enabled && 'AUTOSETUP_LIVE_TESTS!=1' }, async () => {
    await run(process.execPath, ['features/odata-demo/scripts/read-1c-odata-metadata.js'], { cwd: projectRoot, env });

    const { config } = await import('../../configure.js');
    const dbinfo = JSON.parse(await readFile(config.oneCOData.metadata.dumpPath, 'utf8'));

    for (const name of Object.keys(config.oneCOData.rights)) {
        const document = dbinfo.entities['Document_' + name];
        assert.ok(document, `${name} is missing from the dump`);
        assert.equal(document.kind, 'document');
        assert.deepEqual(document.key, ['Ref_Key']);
        // Реквизиты, на которые опирается список: номер, дата и оба флага состояния.
        for (const field of ['Ref_Key', 'DataVersion', 'Number', 'Date', 'Posted', 'DeletionMark']) {
            assert.ok(document.fields.some((item) => item.name === field), `${name}.${field} is missing`);
        }
        assert.ok(Object.keys(document.tables).length > 0, `${name} has no tabular sections`);
        // Каждая табличная часть должна быть вытащена как самостоятельная сущность,
        // иначе редактор строк не из чего будет генерировать.
        for (const { row_type } of Object.values(document.tables)) {
            assert.equal(dbinfo.entities[row_type]?.kind, 'table', `${row_type} is not in the dump`);
        }
    }

    for (const name of Object.keys(config.oneCOData.catalogRights)) {
        assert.equal(dbinfo.entities['Catalog_' + name]?.kind, 'catalog', `${name} is missing from the dump`);
    }
});

test('the dump is stable across runs', { skip: !enabled && 'AUTOSETUP_LIVE_TESTS!=1' }, async () => {
    const { config } = await import('../../configure.js');
    const first = await readFile(config.oneCOData.metadata.dumpPath, 'utf8');
    await run(process.execPath, ['features/odata-demo/scripts/read-1c-odata-metadata.js'], { cwd: projectRoot, env });
    assert.equal(await readFile(config.oneCOData.metadata.dumpPath, 'utf8'), first);
});
