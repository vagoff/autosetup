import { existsSync, rmSync } from 'node:fs';
import { config } from './config.js';

// Убирает install-complete.marker, если он есть. Идемпотентно — см.
// destroy-disk-image.js/destroy-tpm-state-dir.js. Обязательная пара к
// mark-windows-install-complete.js: снёс диск — обязан снести и факт
// "install на нём завершён", иначе следующий run-vm.js на чистом диске
// молча попробует грузиться не с CD.
export function destroyWindowsInstallCompleteMarker() {
    const { installCompleteMarkerPath } = config.paths;
    if (!existsSync(installCompleteMarkerPath)) {
        console.log(`нечего удалять: ${installCompleteMarkerPath}`);
        return;
    }
    rmSync(installCompleteMarkerPath);
    console.log(`удалён ${installCompleteMarkerPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroyWindowsInstallCompleteMarker();
}
