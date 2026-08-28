import { existsSync } from 'node:fs';
import { config } from '../../configure.js';
import { resolveBootFromInstaller } from '../../infrastructure/resolve-boot-from-installer.js';
import { destroyVmResources } from './destroy-vm-resources.js';
import { createVmResources } from './create-vm-resources.js';

// Windows Setup, при повторной загрузке с CD поверх диска, где уже лежит
// недоконченный предыдущий проход (файлы скопированы частично, полноценного
// загрузчика ещё нет), сама показывает интерактивный диалог "It looks like
// you started an upgrade and booted from installation media" — отдельный
// WinPE-экран, autounattend.xml до него не достаёт (это происходит раньше
// применения ответов). Отвечать на него программно (клик/клавиша по
// конкретной версии этого диалога) — тот самый специфичный к версии хак,
// которого требования явно просят избегать: в другой сборке Windows он
// может выглядеть или называться иначе.
//
// Architecturally надёжный путь вместо распознавания экрана: если
// предыдущая попытка установки прервалась (есть boot-активность в
// com1.log, но install-complete.marker так и не появился), эта попытка
// невосстановимо не нужна — до install-complete.marker никаких данных
// пользователя ещё не существует, терять нечего. Пересобираем диск/OVMF
// vars/tpm/ssh-key с нуля, и следующая CD-загрузка гарантированно видит
// пустой диск — диалог просто не появляется, потому что нечему появляться.
export async function restartInstallIfInterrupted() {
    if (!resolveBootFromInstaller()) return; // уже установлено — не наша забота
    if (!existsSync(config.qemu.serialLogPath)) return; // диск ещё ни разу не грузился — пристинный

    console.log(`прерванная предыдущая попытка установки (${config.qemu.serialLogPath} не пуст, install-complete.marker нет) — пересобираю VM с нуля`);
    destroyVmResources();
    await createVmResources();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    restartInstallIfInterrupted().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
