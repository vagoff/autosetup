import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { config } from './config.js';

// Скачивает Windows ISO по зафиксированному в конфиге URL. Никогда не
// перезаписывает существующий файл молча — если нужно перекачать,
// удали файл явно сам. Целостность проверяется сравнением размера с
// заранее известным значением из конфига (детерминированная проверка,
// а не догадка по состоянию).
export async function downloadWindowsIso() {
  const targetPath = path.join(config.paths.isoDir, config.windowsIso.filename);
  if (existsSync(targetPath)) {
    throw new Error(
      `ISO уже существует: ${targetPath}. Удали файл явно перед повторным скачиванием.`
    );
  }

  mkdirSync(config.paths.isoDir, { recursive: true });
  const tmpPath = `${targetPath}.part`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);

  console.log(`скачиваю ${config.windowsIso.url}`);
  const response = await fetch(config.windowsIso.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));

  const { size } = statSync(tmpPath);
  if (size !== config.windowsIso.expectedBytes) {
    unlinkSync(tmpPath);
    throw new Error(
      `размер ${size} не совпадает с ожидаемым ${config.windowsIso.expectedBytes}, ` +
      `неполный файл удалён`
    );
  }

  renameSync(tmpPath, targetPath);
  console.log(`сохранено: ${targetPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  downloadWindowsIso().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
