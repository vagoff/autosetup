import { config } from '../configure.js';
import { runProcess } from '../lib/run-process.js';

// Заводит стандартные ключи Microsoft (PK/KEK/db) и включает Secure Boot
// в per-VM копии OVMF_VARS через внешний virt-fw-vars — свежескопированный
// шаблон приходит совсем пустым (без единой EFI-переменной), а Windows 11
// Setup жёстко требует именно ВКЛЮЧЁННЫЙ Secure Boot, не просто
// поддержку прошивкой (см. обоснование в data/base.json5).
//
// Модифицирует vars-файл in-place. Вызывается ровно один раз, сразу
// после provisionOvmfVars() в create-vm-resources.js, пока файл гарантированно
// свежескопирован и пуст — на уже заведённый vars-файл запускать повторно
// не имеет смысла (задвоит ключи), поэтому отдельного fail-fast guard'а
// тут нет: гарантия "файл свежий" — забота вызывающего оркестратора.
export async function enrollSecureBootKeys() {
    const { varsPath } = config.ovmf;
    const { binary } = config.ovmf.secureBoot;
    await runProcess(binary, ['--inplace', varsPath, '--enroll-microsoft', '--secure-boot']);
    console.log(`заведены ключи Secure Boot в ${varsPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    enrollSecureBootKeys().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
