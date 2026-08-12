import { existsSync, rmSync } from 'node:fs';
import { config } from './config.js';

// Удаляет состояние swtpm (директорию целиком), если она есть.
// Идемпотентно — см. destroy-disk-image.js.
export function destroyTpmStateDir() {
  const { stateDir } = config.tpm;
  if (!existsSync(stateDir)) {
    console.log(`нечего удалять: ${stateDir}`);
    return;
  }
  rmSync(stateDir, { recursive: true });
  console.log(`удалена ${stateDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  destroyTpmStateDir();
}
