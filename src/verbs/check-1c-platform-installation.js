import { config } from '../configure.js';
import { withGuestSession } from '../infrastructure/with-guest-session.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from '../infrastructure/read-1c-platform-state.js';

export async function checkOneCPlatformInstallation() {
    await withGuestSession(async ({ ssh }) => {
        const state = await readOneCPlatformState(ssh, config.oneC);
        if (!isOneCPlatformInstalled(state, config.oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(state)}`);
        }
    });
    console.log(`1C platform installation: OK (${config.oneC.version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCPlatformInstallation().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
