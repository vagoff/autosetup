import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { config } from '../configure.js';

function waitForUnixSocket(socketPath, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const attempt = () => {
            const socket = net.connect({ path: socketPath }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', () => {
                socket.destroy();
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error(`не дождался unix-сокета ${socketPath}`));
                }
                setTimeout(attempt, 100);
            });
        };
        attempt();
    });
}

// Запускает swtpm (виртуальный TPM 2.0). Control-канал — unix-сокет
// (единственное исключение из "tcp, не unix sockets", см. комментарий в
// data/base.json5: qemu передаёт fd через CMD_SET_DATAFD/SCM_RIGHTS, что
// физически возможно только на AF_UNIX). Дожидается готовности сокета,
// прежде чем отдать управление вызывающему.
export async function spawnSwtpmProcess() {
    const { stateDir, ctrlSocketPath, binary } = config.tpm;
    if (!existsSync(stateDir)) {
        throw new Error(`нет TPM state dir: ${stateDir}. Сначала запусти create-vm-resources.js`);
    }

    // Сокет — рантайм-артефакт этого процесса, не состояние TPM. Огрызок от
    // предыдущего аварийно завершённого запуска блокирует bind — чистим.
    rmSync(ctrlSocketPath, { force: true });

    const child = spawn(
        binary,
        [
            'socket', '--tpm2',
            '--tpmstate', `dir=${stateDir}`,
            '--ctrl', `type=unixio,path=${ctrlSocketPath}`,
        ],
        { stdio: 'inherit' }
    );

    const spawnFailure = new Promise((_, reject) => {
        child.on('error', (error) => reject(new Error(`не смог запустить ${binary}: ${error.message}`)));
    });

    await Promise.race([waitForUnixSocket(ctrlSocketPath, 10000), spawnFailure]);
    return child;
}
