import { destroyDiskImage } from './destroy-disk-image.js';
import { destroyOvmfVars } from './destroy-ovmf-vars.js';
import { destroyTpmStateDir } from './destroy-tpm-state-dir.js';
import { destroySshClientKey } from './destroy-ssh-client-key.js';

// Тонкий оркестратор, обратный create-vm-resources.js: последовательно
// сносит все R/W-ресурсы VM (диск, OVMF vars, tpm state) для чистого
// перезапуска установки с нуля. Никакой собственной логики.
function destroyVmResources() {
    destroyDiskImage();
    destroyOvmfVars();
    destroyTpmStateDir();
    destroySshClientKey();
}

destroyVmResources();
