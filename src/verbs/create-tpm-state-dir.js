import { mkdirSync } from 'node:fs';
import { config } from '../configure.js';

// Директория состояния swtpm. mkdir -p безопасно повторять (создание
// директории не теряет и не портит уже накопленное в ней состояние TPM,
// в отличие от файлов диска/ISO) — поэтому здесь нет guard'а на "уже есть".
export function createTpmStateDir() {
    mkdirSync(config.tpm.stateDir, { recursive: true });
    console.log(`готово: ${config.tpm.stateDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createTpmStateDir();
}
