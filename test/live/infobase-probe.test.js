import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
async function runProbe(mode, outputFilename) {
    await execFileAsync(process.execPath, [
        'src/run-1c-query.js',
        mode,
        '--output', outputFilename,
    ], {
        cwd: projectRoot,
        env: { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' },
    });
    return JSON.parse(await readFile(path.join(projectRoot, 'output', outputFilename), 'utf8'));
}

test('live headless query executes SELECT 1 through external connection', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 10_000,
}, async () => {
    const { stdout } = await execFileAsync(process.execPath, [
        'src/run-1c-external-query.js', '--select-one', '--output', 'select-one.json',
    ], { cwd: projectRoot, env: { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' } });
    assert.deepEqual(JSON.parse(stdout), { ok: true, hasRow: true, error: '' });
});
