import { existsSync, rmSync } from 'node:fs';
import { config } from '../configure.js';

// Удаляет cache/<vmName>/com1.log, если он есть. Идемпотентно — см.
// destroy-disk-image.js.
//
// Обязательная часть чистого сброса VM для переустановки, хоть и лежит в
// cache/, а не в db/: com1.log копится в режиме append (см.
// capture-serial-log.js) и переживает и рестарты процесса, и полный снос
// диска. Если не почистить его вместе с диском — mark-windows-install-
// complete.js увидит строку "ALL DONE" от СТАРОЙ установки ещё ДО того,
// как реально завершится первый логон новой, и создаст ложный маркер
// (см. историю задачи — воспроизведено вживую при тестировании).
export function destroySerialLog() {
    const { serialLogPath } = config.qemu;
    if (!existsSync(serialLogPath)) {
        console.log(`нечего удалять: ${serialLogPath}`);
        return;
    }
    rmSync(serialLogPath);
    console.log(`удалён ${serialLogPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroySerialLog();
}
