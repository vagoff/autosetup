import { config } from './config.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { isOneCPlatformInstalled, readOneCPlatformState } from './lib/read-1c-platform-state.js';

export async function checkOneCPlatformInstallation() {
    const ssh = await connectGuestSsh();
    try {
        const state = await readOneCPlatformState(ssh, config.oneC);
        if (!isOneCPlatformInstalled(state, config.oneC)) {
            throw new Error(`1C platform is not installed as configured: ${JSON.stringify(state)}`);
        }
        console.log(`1C platform installation: OK (${config.oneC.version})`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCPlatformInstallation().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
