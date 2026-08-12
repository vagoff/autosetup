import { readFileSync } from 'node:fs';

// Просит qemu сохранить текущий кадр экрана VM в PPM-файл на диске и
// прочитывает его в память. screendumpPath — переиспользуемый рантайм-путь
// (см. config.qemu.screendumpPath), файл каждый раз перезаписывается.
export async function captureScreendump(qmp, screendumpPath) {
  await qmp.execute('screendump', { filename: screendumpPath });
  return readFileSync(screendumpPath);
}
