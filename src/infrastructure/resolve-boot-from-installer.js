import { existsSync } from 'node:fs';
import { config } from '../configure.js';

// Не конфиг, а наблюдаемый факт про конкретный db/<vmName>/disk.qcow2:
// пережил он уже один успешный install Windows или нет (см.
// src/verbs/mark-windows-install-complete.js — кто и когда создаёт маркер).
// Новый диск после destroy-vm-resources.js снова требует boot с CD сам
// по себе, без ручной правки конфига.
export function resolveBootFromInstaller() {
    return !existsSync(config.paths.installCompleteMarkerPath);
}
