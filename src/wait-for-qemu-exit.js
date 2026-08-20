import { config } from './config.js';
import { probeTcpPort } from './lib/probe-tcp-port.js';

// Ждёт, пока QMP-порт перестанет принимать соединения — то есть пока сам
// процесс qemu реально не завершится. Сетевая, а не PID-based проверка:
// агент работает в отдельном PID-namespace (bwrap --unshare-all,
// расшарена только сеть), process.kill(pid, 0) там всегда "никого не
// находит", даже если qemu жив на хосте (см. памятку в scripts/shutdown.sh
// про ту же проблему для человеческого хостового скрипта).
//
// Верхний предохранитель — qemu.guestShutdownTimeoutMs: fail-fast, если
// гость завис или отказался штатно выключаться, а не бесконечное
// ожидание.
export async function waitForQemuExit() {
    const { loopbackHost } = config.network;
    const { qmpPort, guestShutdownTimeoutMs } = config.qemu;
    const pollIntervalMs = 1000;
    const deadline = Date.now() + guestShutdownTimeoutMs;

    while (Date.now() < deadline) {
        const stillUp = await probeTcpPort(loopbackHost, qmpPort, pollIntervalMs);
        if (!stillUp) {
            console.log('qemu процесс завершился (QMP-порт больше не слушает)');
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`qemu не завершился за ${guestShutdownTimeoutMs}мс после запроса выключения гостя`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    waitForQemuExit().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
