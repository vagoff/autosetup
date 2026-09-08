import { config } from '../configure.js';
import { executeSerialCommand } from '../tools/execute-serial-command.js';

// Ставит Windows в штатный shutdown через SYSTEM serial-agent. Это не
// ACPI-button (у неё наблюдались hibernate и no-op при QMP answered), а
// явная команда ОС; detach обязателен, потому что shutdown.exe завершится
// лишь вместе с самой Windows, уже после commandTimeoutMs serial-agent'а.
export async function requestGuestShutdown() {
    await executeSerialCommand(config.serialAgent.shutdownCommand, { detach: true });
    console.log('Windows shutdown.exe отправлен через COM2 serial-agent');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    requestGuestShutdown().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
