import { config } from './config.js';
import { connectGuestSsh } from './lib/connect-guest-ssh.js';
import { isApacheHttpdInstalled, readApacheHttpdState } from './lib/read-apache-httpd-state.js';

export async function checkApacheHttpdInstallation() {
    const ssh = await connectGuestSsh();
    try {
        const state = await readApacheHttpdState(ssh, config.apacheHttpd);
        if (!isApacheHttpdInstalled(state, config.apacheHttpd)) {
            throw new Error(`Apache HTTP Server is not installed as configured: ${JSON.stringify(state)}`);
        }
        console.log(`Apache HTTP Server installation: OK (${config.apacheHttpd.version})`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkApacheHttpdInstallation().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
