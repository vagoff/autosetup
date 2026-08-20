import { destroyDiskImage } from './destroy-disk-image.js';
import { destroyOvmfVars } from './destroy-ovmf-vars.js';
import { destroyTpmStateDir } from './destroy-tpm-state-dir.js';
import { destroySshClientKey } from './destroy-ssh-client-key.js';
import { destroyWindowsInstallCompleteMarker } from './destroy-windows-install-complete-marker.js';
import { destroySerialLog } from './destroy-serial-log.js';

// Тонкий оркестратор, обратный create-vm-resources.js: последовательно
// сносит все R/W-ресурсы VM (диск, OVMF vars, tpm state) для чистого
// перезапуска установки с нуля. Никакой собственной логики.
//
// Экспортирована и вызывается только под import.meta.url-охраной ниже —
// НЕ на верхнем уровне модуля. Простой import этого файла раньше сносил
// диск/OVMF vars/tpm state/ssh-ключи как побочный эффект самого импорта,
// без единого явного вызова — см. историю задачи (реальная потеря
// установленной VM).
export function destroyVmResources() {
    destroyDiskImage();
    destroyOvmfVars();
    destroyTpmStateDir();
    destroySshClientKey();
    destroyWindowsInstallCompleteMarker();
    destroySerialLog();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroyVmResources();
}
