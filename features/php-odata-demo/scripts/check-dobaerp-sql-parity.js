#!/usr/bin/env node
'use strict';

// Приёмочный шлюз расшивки idiomlib от SQL.
//
// Требование: наши правки в dol_table_layout.js и соседях НЕ меняют ни байта
// в том, что генерирует dobaerp сегодня. Иначе это тихий форк, а форк запрещён.
//
// Как проверяем: дважды прогоняем настоящий генератор WMS в двух одноразовых
// песочницах-копиях -- эталонной (нетронутые исходники dobaerp) и оверлейной
// (наши файлы поверх) -- и сравниваем всё, что он произвёл, побайтово.
// Хранимого baseline нет намеренно: он протухает молча, а живой эталон -- нет.

const afs = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const pth = require('path');
const {execFile} = require('child_process');
const {promisify} = require('util');
const JSON5 = require('json5');

const exec_file = promisify(execFile);
const project_dir = pth.join(__dirname, '..');

async function read_config() {
    const text = await afs.readFile(pth.join(project_dir, 'data/gen-config.json5'), 'utf8');
    return JSON5.parse(text).dobaerp;
}

// Генератор вписывает в шапку сгенерённых модулей абсолютный путь до себя,
// а песочницы у нас две с разными именами. Это не расхождение выхода, поэтому
// путь песочницы нормализуем -- но именно его, а не произвольные отличия.
function normalize(data, sandbox) {
    return Buffer.from(data.toString('latin1').split(sandbox).join('<SANDBOX>'), 'latin1');
}

async function hash_tree(root, sandbox) {
    const hashes = new Map();
    async function walk(dir) {
        let entries;
        try {
            entries = await afs.readdir(dir, {withFileTypes: true});
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const full = pth.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                const data = normalize(await afs.readFile(full), sandbox);
                hashes.set(pth.relative(root, full), crypto.createHash('sha256').update(data).digest('hex'));
            }
        }
    }
    await walk(root);
    return hashes;
}

async function make_sandbox(config, overlay_enabled) {
    const sandbox = await afs.mkdtemp(pth.join(os.tmpdir(), 'dobaerp-parity-'));
    // Копируем только то, что нужно генератору: он пишет и в output/docroot,
    // и обратно в src/wms/*_auto.js, поэтому работать в живом дереве нельзя.
    for (const name of ['src', 'data', 'package.json']) {
        await afs.cp(pth.join(config.root, name), pth.join(sandbox, name), {recursive: true});
    }
    // node_modules только читается -- симлинка достаточно и она экономит секунды.
    await afs.symlink(pth.join(config.root, 'node_modules'), pth.join(sandbox, 'node_modules'));
    // Генератор дописывает в уже существующий скелет модуля (langs и прочее).
    const docroot = pth.join(sandbox, config.docrootSubdirectory);
    await afs.mkdir(pth.join(docroot, 'custom'), {recursive: true});
    await afs.cp(pth.join(config.root, config.docrootSubdirectory, 'custom/wms'), pth.join(docroot, 'custom/wms'), {recursive: true});

    if (overlay_enabled) {
        for (const [upstream_path, our_path] of Object.entries(config.overlay)) {
            await afs.copyFile(pth.join(project_dir, our_path), pth.join(sandbox, upstream_path));
        }
    }
    return sandbox;
}

async function generate(config, overlay_enabled) {
    const sandbox = await make_sandbox(config, overlay_enabled);
    const docroot = pth.join(sandbox, config.docrootSubdirectory);
    await exec_file(process.execPath, [config.generatorScript], {
        cwd: sandbox,
        env: {
            ...process.env,
            // Обе переменные обязательны и обе неочевидны:
            //  * DOCUMENT_ROOT читает src/wms_api/install.js;
            //  * PROJECTS_DIR перебивает захардкоженный абсолютный путь в
            //    src/wms/wms_app_data.js (output_dir), иначе генератор пишет
            //    в ЖИВОЙ docroot dobaerp мимо песочницы.
            PROJECTS_DIR: sandbox + pth.sep,
            DOCUMENT_ROOT: docroot,
        },
    });
    const result = new Map();
    for (const directory of config.comparedDirectories) {
        for (const [relative, hash] of await hash_tree(pth.join(sandbox, directory), sandbox)) {
            result.set(pth.join(directory, relative), hash);
        }
    }
    return {sandbox, result};
}

// Страховка от повторения уже случившегося: генератор dobaerp содержит
// абсолютные пути по умолчанию, и один пропущенный env-параметр отправляет
// его писать в рабочий сайт. Поэтому вокруг каждой генерации сверяем, что
// живое дерево dobaerp не изменилось ни на байт.
async function guard_live_tree(config, run) {
    const watched = [
        pth.join(config.root, config.docrootSubdirectory, 'custom/wms'),
        pth.join(config.root, 'src'),
    ];
    const before = [];
    for (const directory of watched) before.push(await hash_tree(directory, '\u0000'));
    const result = await run();
    for (const [index, directory] of watched.entries()) {
        const after = await hash_tree(directory, '\u0000');
        for (const [path, hash] of after) {
            if (before[index].get(path) !== hash) {
                throw new Error(`the live dobaerp tree was modified during generation: ${pth.join(directory, path)} -- aborting instead of corrupting the working site`);
            }
        }
        for (const path of before[index].keys()) {
            if (!after.has(path)) throw new Error(`the live dobaerp tree lost a file during generation: ${pth.join(directory, path)}`);
        }
    }
    return result;
}

async function main() {
    const config = await read_config();
    const baseline = await guard_live_tree(config, () => generate(config, false));
    const overlaid = await guard_live_tree(config, () => generate(config, true));

    const differences = [];
    const all_paths = new Set([...baseline.result.keys(), ...overlaid.result.keys()]);
    for (const path of [...all_paths].sort()) {
        const before = baseline.result.get(path);
        const after = overlaid.result.get(path);
        if (before !== after) {
            differences.push(`${path}: ${before ? (after ? 'CHANGED' : 'MISSING after overlay') : 'ADDED by overlay'}`);
        }
    }

    if (differences.length > 0) {
        console.error(`SQL parity FAILED: ${differences.length} of ${all_paths.size} generated files differ`);
        for (const difference of differences) console.error('  ' + difference);
        console.error(`baseline: ${baseline.sandbox}`);
        console.error(`overlaid: ${overlaid.sandbox}`);
        process.exitCode = 1;
        return;
    }

    await afs.rm(baseline.sandbox, {recursive: true, force: true});
    await afs.rm(overlaid.sandbox, {recursive: true, force: true});
    console.log(`SQL parity OK: ${all_paths.size} generated files are byte-identical`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports.main = main;
