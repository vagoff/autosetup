import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';

// Мы держим у себя расшитые копии модулей dobaerp и обязаны влить их обратно.
// Если апстрим уедет вперёд незамеченным, мерж потеряет чужие правки -- то есть
// получится форк. Поэтому рядом с каждой копией лежит pristine-снимок оригинала,
// и этот тест падает, как только оригинал изменился.
const projectDirectory = path.resolve(import.meta.dirname, '../features/php-odata-demo');
const config = JSON5.parse(await readFile(path.join(projectDirectory, 'data/gen-config.json5'), 'utf8')).dobaerp;

for (const [upstreamPath, entry] of Object.entries(config.overlay)) {
    // Файлы, которых в dobaerp ещё нет, сторожить не от чего.
    if (entry.upstream === null) continue;
    test(`pristine copy of ${upstreamPath} matches dobaerp`, async () => {
        const pristine = path.join(projectDirectory, entry.upstream);
        const actual = await readFile(path.join(config.root, upstreamPath), 'utf8');
        assert.equal(
            await readFile(pristine, 'utf8'),
            actual,
            `${upstreamPath} changed in dobaerp: re-apply our changes on top of the new upstream and refresh ${pristine}`,
        );
    });
}
