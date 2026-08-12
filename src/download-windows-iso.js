import path from 'node:path';
import { config } from './config.js';
import { downloadArtifact } from './lib/download-artifact.js';

// Скачивает Windows ISO по зафиксированному в конфиге URL. Никогда не
// перезаписывает существующий файл молча — если нужно перекачать,
// удали файл явно сам. Целостность проверяется сравнением размера с
// заранее известным значением из конфига (детерминированная проверка,
// а не догадка по состоянию).
export async function downloadWindowsIso() {
  const targetPath = path.join(config.paths.isoDir, config.windowsIso.filename);
  await downloadArtifact({
    url: config.windowsIso.url,
    targetPath,
    expectedBytes: config.windowsIso.expectedBytes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  downloadWindowsIso().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
