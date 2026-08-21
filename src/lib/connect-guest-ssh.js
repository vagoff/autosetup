import { NodeSSH } from 'node-ssh';
import { config } from '../config.js';

// Единственная точка создания SSH-клиента к работающему гостю. Все параметры
// соединения уже принадлежат конфигу фичи OpenSSH и не дублируются в модулях
// установки программ.
export async function connectGuestSsh() {
    const { network, unattend, openSsh } = config;
    if (!openSsh) throw new Error('the active VM profile has no openssh feature');
    const ssh = new NodeSSH();
    try {
        await ssh.connect({
            host: network.loopbackHost,
            port: openSsh.hostPort,
            username: unattend.adminUsername,
            privateKeyPath: openSsh.clientPrivateKeyPath,
            readyTimeout: openSsh.check.connectTimeoutSeconds * 1000,
            tryKeyboard: false,
        });
        return ssh;
    } catch (error) {
        ssh.dispose();
        throw error;
    }
}
