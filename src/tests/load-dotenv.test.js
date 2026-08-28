import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadDotenv } from '../src/lib/load-dotenv.js';

test('dotenv fills only missing values, so exported environment wins', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autosetup-dotenv-'));
    const pathname = path.join(directory, '.env');
    await writeFile(pathname, '# comment\nAUTOSETUP_PROFILE=data/profiles/default.json5\nOTHER=value\n', 'utf8');
    const environment = { AUTOSETUP_PROFILE: 'data/profiles/explicit.json5' };
    loadDotenv(pathname, environment);
    assert.equal(environment.AUTOSETUP_PROFILE, 'data/profiles/explicit.json5');
    assert.equal(environment.OTHER, 'value');
});
