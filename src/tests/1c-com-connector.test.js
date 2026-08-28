import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('COM connector registration uses the configured DLL and verifies its ProgID', async () => {
    const source = await readFile(new URL('../verbs/register-1c-com-connector.js', import.meta.url), 'utf8');
    assert.match(source, /oneC\.comConnectorPath/u);
    assert.match(source, /V83\.COMConnector/u);
    assert.match(source, /regsvr32/u);
});
