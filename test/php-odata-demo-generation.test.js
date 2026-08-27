import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Генерация модуля должна быть детерминированной: одинаковый конфиг и
// одинаковые метаданные -> одинаковый PHP. Манифест хешей ловит любые
// незамеченные изменения генератора; git diff по манифесту показывает,
// какой именно файл поехал, после чего его смотрят глазами.

const run = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const generator = path.join(projectRoot, 'features/php-odata-demo/scripts/generate-odatatest-module.js');
const manifestPath = path.join(projectRoot, 'features/php-odata-demo/data/generated-manifest.json');

async function listFiles(root, prefix = '') {
    const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const relative = path.join(prefix, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(root, relative));
        else files.push(relative);
    }
    return files;
}

async function generate() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'odatatest-gen-'));
    await run(process.execPath, [generator], { env: { ...process.env, ODATATEST_OUTPUT_ROOT: directory } });
    return directory;
}

async function buildManifest(directory) {
    const manifest = {};
    for (const relative of await listFiles(directory)) {
        // Секреты не версионируем: там пароль, и он меняется независимо.
        if (relative.startsWith('secrets' + path.sep)) continue;
        const text = await readFile(path.join(directory, relative), 'utf8');
        // Пути прогонов различаются (временный каталог против рабочего docroot),
        // это не расхождение генерации.
        const normalized = text.split(directory).join('<OUTPUT_ROOT>');
        manifest[relative] = createHash('sha256').update(normalized).digest('hex');
    }
    return manifest;
}

test('generated module matches the approved manifest', async () => {
    const directory = await generate();
    try {
        const manifest = await buildManifest(directory);
        if (process.env.ODATATEST_APPROVE === '1') {
            await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
            return;
        }
        const approved = JSON.parse(await readFile(manifestPath, 'utf8'));
        assert.deepEqual(
            manifest,
            approved,
            'сгенерированный модуль отличается от утверждённого; проверьте изменения и обновите манифест: ODATATEST_APPROVE=1 node --test test/php-odata-demo-generation.test.js',
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('every generated php file is syntactically valid', async () => {
    const directory = await generate();
    try {
        for (const relative of await listFiles(directory)) {
            if (!relative.endsWith('.php')) continue;
            const { stdout } = await run('php', ['-l', path.join(directory, relative)]);
            assert.match(stdout, /No syntax errors detected/u, `${relative}: ${stdout}`);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
