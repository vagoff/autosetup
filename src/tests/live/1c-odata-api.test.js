import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../../..');

test('live 1C exposes the OData composition and infobase-user APIs required by the publisher', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 60_000,
}, async () => {
    const { stdout } = await execFileAsync(process.execPath, ['src/verbs/probe-1c-odata-api.js'], {
        cwd: projectRoot,
        env: { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' },
    });
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.ok(Array.isArray(report.roleNames));
    assert.ok(report.roleNames.includes('УдаленныйДоступСтандартныйИнтерфейсOData'));
});
