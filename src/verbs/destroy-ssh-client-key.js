import { existsSync, rmSync } from 'node:fs';
import { config } from '../configure.js';

// Явно удаляет обе части SSH client key вместе. Это часть полного сброса
// VM: новый диск не должен наследовать ключ авторизации старой VM.
export function destroySshClientKey() {
    for (const keyPath of [config.openSsh.clientPrivateKeyPath, config.openSsh.clientPublicKeyPath]) {
        if (!existsSync(keyPath)) {
            console.log(`нечего удалять: ${keyPath}`);
            continue;
        }
        rmSync(keyPath);
        console.log(`удалён ${keyPath}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    destroySshClientKey();
}
