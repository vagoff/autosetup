import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// Потоком, а не readFileSync: артефакты 1С -- сотни мегабайт, целиком в
// память их класть незачем.
async function sha256(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

// Проверяет локальные, уже доставленные в проект бинарные артефакты до
// любого действия над гостем. Это не доверяет ни имени файла, ни тому, что
// его когда-то уже проверял downloader: vendor/ допускает ручную замену.
export async function assertArtifactFiles(sourceDirectory, expectedFiles) {
    const seenFilenames = new Set();
    const resolved = [];
    for (const expected of expectedFiles) {
        if (seenFilenames.has(expected.filename)) {
            throw new Error(`manifest ${sourceDirectory}: filename repeated: ${expected.filename}`);
        }
        seenFilenames.add(expected.filename);
        const filePath = path.join(sourceDirectory, expected.filename);
        if (!existsSync(filePath)) throw new Error(`artifact is missing: ${filePath}`);
        const { size } = statSync(filePath);
        if (size !== expected.expectedBytes) {
            throw new Error(`artifact size mismatch: ${filePath}: got ${size}, expected ${expected.expectedBytes}`);
        }
        const actualSha256 = await sha256(filePath);
        if (actualSha256 !== expected.expectedSha256) {
            throw new Error(`artifact SHA-256 mismatch: ${filePath}: got ${actualSha256}, expected ${expected.expectedSha256}`);
        }
        resolved.push({ ...expected, filePath });
    }
    return resolved;
}
