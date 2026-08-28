import { config } from './config.js';
import { withGuestSession } from './lib/with-guest-session.js';
import { isOneCTechsysUpdateInstalled, readOneCTechsysUpdateState } from './lib/read-1c-techsys-update-state.js';

export async function checkOneCTechsysUpdateInstallation() {
    await withGuestSession(async ({ ssh }) => {
        const state = await readOneCTechsysUpdateState(ssh, config.oneCTechsysUpdate);
        if (!isOneCTechsysUpdateInstalled(state, config.oneCTechsysUpdate)) {
            throw new Error(`1C techsys update is not installed as configured: ${JSON.stringify(state)}`);
        }
    });
    console.log('1C techsys update installation: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCTechsysUpdateInstallation().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
