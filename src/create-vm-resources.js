import { createDiskImage } from './create-disk-image.js';
import { provisionOvmfVars } from './provision-ovmf-vars.js';
import { createTpmStateDir } from './create-tpm-state-dir.js';

// Тонкий оркестратор: только последовательно вызывает модули создания
// ресурсов, без собственной логики. Запускается один раз перед первым
// стартом VM. Каждый шаг сам решает, fail-fast ему или нет.
async function createVmResources() {
  await createDiskImage();
  provisionOvmfVars();
  createTpmStateDir();
}

createVmResources().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
