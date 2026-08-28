import { requestGuestShutdown } from '../request-guest-shutdown.js';
import { waitForQemuExit } from '../wait-for-qemu-exit.js';

// Тонкий оркестратор: попросить гостя штатно выключиться (ACPI) и
// дождаться, пока qemu-процесс реально завершится. Никакой собственной
// логики — она вся в request-guest-shutdown.js/wait-for-qemu-exit.js.
// Единственный способ выключить VM, который агент может вызвать сам, по
// сети, из sandboxed-контейнера (в отличие от scripts/shutdown.sh — тот
// PID-based и работает только у человека на хосте).
export async function shutdownGuest() {
    await requestGuestShutdown();
    await waitForQemuExit();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    shutdownGuest().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
