import { createDiskImage } from './create-disk-image.js';
import { provisionOvmfVars } from './provision-ovmf-vars.js';
import { enrollSecureBootKeys } from './enroll-secure-boot-keys.js';
import { createTpmStateDir } from './create-tpm-state-dir.js';
import { createSshClientKey } from './create-ssh-client-key.js';

// Тонкий оркестратор: только последовательно вызывает модули создания
// ресурсов, без собственной логики. Запускается один раз перед первым
// стартом VM. Каждый шаг сам решает, fail-fast ему или нет.
//
// Экспортирована и вызывается только под import.meta.url-охраной ниже —
// НЕ на верхнем уровне модуля. Простой import этого файла (например,
// диагностический "проверить, что модуль вообще грузится без ошибок")
// не должен иметь побочных эффектов на диске — см. историю задачи
// (тот же баг в destroy-vm-resources.js уже стоил реальных данных).
export async function createVmResources() {
    await createDiskImage();
    provisionOvmfVars();
    await enrollSecureBootKeys();
    createTpmStateDir();
    createSshClientKey();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createVmResources().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
