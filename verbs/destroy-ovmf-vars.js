import { existsSync, rmSync } from 'node:fs';
import { config } from './config.js';

// Удаляет per-VM копию OVMF_VARS (состояние UEFI/secure-boot), если она
// есть. Идемпотентно — см. destroy-disk-image.js.
export function destroyOvmfVars() {
    const { varsPath } = config.ovmf;
    if (!existsSync(varsPath)) {
        console.log(`нечего удалять: ${varsPath}`);
        return;
    }
    rmSync(varsPath);
    console.log(`удалён ${varsPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroyOvmfVars();
}
