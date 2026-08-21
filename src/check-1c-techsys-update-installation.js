import { config } from './config.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { isOneCTechsysUpdateInstalled, readOneCTechsysUpdateState } from './lib/read-1c-techsys-update-state.js';

export async function checkOneCTechsysUpdateInstallation() {
    const ssh = await connectGuestSsh();
    try {
        const state = await readOneCTechsysUpdateState(ssh, config.oneCTechsysUpdate);
        if (!isOneCTechsysUpdateInstalled(state, config.oneCTechsysUpdate)) {
            throw new Error(`1C techsys update is not installed as configured: ${JSON.stringify(state)}`);
        }
        console.log('1C techsys update installation: OK');
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCTechsysUpdateInstallation().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
