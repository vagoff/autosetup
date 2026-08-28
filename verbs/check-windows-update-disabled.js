import { config } from './config.js';
import { withGuestSession } from './lib/with-guest-session.js';
import { findWindowsUpdateDeviations, readWindowsUpdateState } from './lib/read-windows-update-state.js';

// Проверяет ровно то, что объявлено в data/base.json5 -> windowsUpdate.
// При disable: false проверять нечего — это не «проверка прошла», а
// «состояние не объявлено», поэтому так и сообщаем.
export async function checkWindowsUpdateDisabled() {
    const { windowsUpdate } = config;
    if (!windowsUpdate.disable) {
        console.log('Windows Update: выключение не объявлено (base.json5 -> windowsUpdate.disable = false), проверять нечего');
        return;
    }
    await withGuestSession(async ({ ssh }) => {
        const state = await readWindowsUpdateState(ssh, windowsUpdate);
        const deviations = findWindowsUpdateDeviations(state);
        if (deviations.length > 0) {
            throw new Error(`Windows Update не выключен как объявлено:\n  ${deviations.join('\n  ')}`);
        }
    });
    console.log('Windows Update disabled: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkWindowsUpdateDisabled().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
