import { config } from './config.js';
import { downloadArtifact } from './lib/download-artifact.js';

// Скачивает ровно закреплённый в JSON5 архив Win32-OpenSSH. Проверка
// SHA-256 нужна до того, как ZIP попадёт на установочный USB-образ.
export async function downloadOpenSshArchive() {
  await downloadArtifact({
    url: config.openSsh.url,
    targetPath: config.openSsh.archivePath,
    expectedSha256: config.openSsh.expectedSha256,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  downloadOpenSshArchive().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
