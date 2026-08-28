import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { hashFileSha256 } from './hash-file-sha256.js';

function removeFileIfExists(filePath) {
    if (existsSync(filePath)) unlinkSync(filePath);
}

// Возвращает описание несовпадения или null, если файл соответствует
// манифесту. Ничего не решает сама — вызывающий код решает, ошибка это или
// повод считать шаг уже выполненным.
async function findManifestMismatch(filePath, { expectedBytes, expectedSha256 }) {
    if (expectedBytes !== undefined) {
        const { size } = statSync(filePath);
        if (size !== expectedBytes) return `размер ${size} не совпадает с ожидаемым ${expectedBytes}`;
    }
    if (expectedSha256 !== undefined) {
        const actualSha256 = await hashFileSha256(filePath);
        if (actualSha256 !== expectedSha256) return `SHA-256 ${actualSha256} не совпадает с ожидаемым ${expectedSha256}`;
    }
    return null;
}

// Скачивает один воспроизводимый внешний артефакт. Если целевой файл уже
// существует, повторно НЕ скачивает: сверяет его с манифестом (размер/
// SHA-256) и либо считает шаг уже выполненным (это ровно тот же файл — лог
// об этом есть, но это не молчаливый пропуск проверки), либо падает с
// понятной ошибкой (что-то другое под этим именем — порча или подмена, а
// не повод тихо перезаписать). Это не смягчение fail-fast, а его
// расширение: у детерминированно проверяемого по хешу файла нет
// промежуточного состояния "наверное можно перекачать на всякий случай" —
// либо он побайтово тот, что нужен, либо явная ошибка.
//
// Пока ответ не прошёл все заданные в конфиге проверки, он существует
// только как .part и при ошибке удаляется.
export async function downloadArtifact({ url, targetPath, expectedBytes, expectedSha256 }) {
    if (existsSync(targetPath)) {
        const mismatch = await findManifestMismatch(targetPath, { expectedBytes, expectedSha256 });
        if (mismatch) {
            throw new Error(`файл уже существует и не совпадает с манифестом: ${targetPath}: ${mismatch}. Удали его явно, если нужно перекачать.`);
        }
        console.log(`уже скачано и проверено: ${targetPath}`);
        return;
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

        const mismatch = await findManifestMismatch(partialPath, { expectedBytes, expectedSha256 });
        if (mismatch) throw new Error(mismatch);

        renameSync(partialPath, targetPath);
        console.log(`сохранено: ${targetPath}`);
    } catch (error) {
        removeFileIfExists(partialPath);
        throw error;
    }
}
