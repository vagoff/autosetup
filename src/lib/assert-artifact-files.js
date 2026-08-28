import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { hashFileSha256 } from './hash-file-sha256.js';

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
        const actualSha256 = await hashFileSha256(filePath);
        if (actualSha256 !== expected.expectedSha256) {
            throw new Error(`artifact SHA-256 mismatch: ${filePath}: got ${actualSha256}, expected ${expected.expectedSha256}`);
        }
        resolved.push({ ...expected, filePath });
    }
    return resolved;
}
