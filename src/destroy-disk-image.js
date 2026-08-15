import { existsSync, rmSync } from 'node:fs';
import { config } from './config.js';

// Удаляет qcow2-диск VM, если он есть. Идемпотентно (в отличие от
// create-disk-image.js, здесь нет риска молча потерять данные —
// destroy вызывается явно и осознанно тем, кто хочет чистый диск).
export function destroyDiskImage() {
    const { path: diskPath } = config.disk;
    if (!existsSync(diskPath)) {
        console.log(`нечего удалять: ${diskPath}`);
        return;
    }
    rmSync(diskPath);
    console.log(`удалён ${diskPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroyDiskImage();
}
