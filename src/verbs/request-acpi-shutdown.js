import { config } from '../configure.js';
import { connectQmp } from '../infrastructure/connect-qmp.js';

// Один QMP-вызов system_powerdown — программный аналог короткого нажатия
// кнопки питания (ACPI power button event). Не ждёт результата: что
// именно сделает гость (штатно завершится, откажется, зависнет) решает
// сам гость и наблюдается отдельно (см. wait-for-qemu-exit.js).
//
// В отличие от scripts/shutdown.sh (SIGTERM/SIGKILL самому процессу
// qemu — для гостя это эквивалент выдернутой из розетки вилки), этот
// путь даёт Windows шанс штатно остановить службы и сбросить диск —
// то, что реально нужно перед тем, как внутри появится боевая 1С-база.
export async function requestGuestShutdown() {
    const { loopbackHost } = config.network;
    const { qmpPort, qmpConnectTimeoutMs } = config.qemu;
    const qmp = await connectQmp(loopbackHost, qmpPort, qmpConnectTimeoutMs);
    try {
        await qmp.execute('system_powerdown');
        console.log('ACPI system_powerdown отправлен гостю');
    } finally {
        qmp.disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    requestGuestShutdown().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
