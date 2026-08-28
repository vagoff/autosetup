import { config } from '../configure.js';
import { downloadArtifact } from '../lib/download-artifact.js';

// Скачивает ровно закреплённый в data/apache-httpd.json5 архив Apache.
// В отличие от «скачай последнюю версию», это действие воспроизводимо:
// URL, размер и SHA-256 — декларативный вход, downloadArtifact оставляет
// результат только после всех проверок.
export async function downloadApacheHttpdArchive() {
    const { apacheHttpd } = config;
    await downloadArtifact({
        url: apacheHttpd.url,
        targetPath: apacheHttpd.archivePath,
        expectedBytes: apacheHttpd.expectedBytes,
        expectedSha256: apacheHttpd.expectedSha256,
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    downloadApacheHttpdArchive().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
