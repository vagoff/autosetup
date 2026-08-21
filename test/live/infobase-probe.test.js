import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
test('live headless query executes SELECT 1 through external connection', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 10_000,
}, async () => {
    const { stdout } = await execFileAsync(process.execPath, [
        'src/run-1c-external-query.js', '--select-one', '--output', 'select-one.json',
    ], { cwd: projectRoot, env: { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' } });
    assert.deepEqual(JSON.parse(stdout), { ok: true, hasRow: true, error: '' });
});

test('live headless document census reads types from Designer metadata and counts through COM', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 360_000,
}, async () => {
    const { stdout } = await execFileAsync(process.execPath, [
        'src/run-1c-headless-documents-top.js', '--documents-top', '10', '--output', 'headless-documents-top.json',
    ], { cwd: projectRoot, env: { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' } });
    assert.equal(JSON.parse(stdout).ok, true);
});
