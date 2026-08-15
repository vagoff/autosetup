import { createHash } from 'node:crypto';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    renameSync,
    statSync,
    unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

function removeFileIfExists(filePath) {
    if (existsSync(filePath)) unlinkSync(filePath);
}

async function calculateSha256(filePath) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), new Transform({
        transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
        },
    }), new Transform({
        transform(_chunk, _encoding, callback) {
            callback();
        },
    }));
    return hash.digest('hex');
}

// Скачивает один воспроизводимый внешний артефакт. Целевой файл никогда
// не перезаписывается: повторное скачивание требует явного удаления. Пока
// ответ не прошёл все заданные в конфиге проверки, он существует только
// как .part и при ошибке удаляется.
export async function downloadArtifact({ url, targetPath, expectedBytes, expectedSha256 }) {
    if (existsSync(targetPath)) {
        throw new Error(`файл уже существует: ${targetPath}. Удали его явно перед повторным скачиванием.`);
    }

    mkdirSync(path.dirname(targetPath), { recursive: true });
    const partialPath = `${targetPath}.part`;
    removeFileIfExists(partialPath);

    try {
        console.log(`скачиваю ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));

        const { size } = statSync(partialPath);
        if (expectedBytes !== undefined && size !== expectedBytes) {
            throw new Error(`размер ${size} не совпадает с ожидаемым ${expectedBytes}`);
        }

        if (expectedSha256 !== undefined) {
            const actualSha256 = await calculateSha256(partialPath);
            if (actualSha256 !== expectedSha256) {
                throw new Error(`SHA-256 ${actualSha256} не совпадает с ожидаемым ${expectedSha256}`);
            }
        }

        renameSync(partialPath, targetPath);
        console.log(`сохранено: ${targetPath}`);
    } catch (error) {
        removeFileIfExists(partialPath);
        throw error;
    }
}
