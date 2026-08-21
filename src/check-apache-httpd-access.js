import { config } from './config.js';
import { waitForHttp } from './lib/wait-for-http.js';

export async function checkApacheHttpdAccess() {
    const { apacheHttpd } = config;
    await waitForHttp({
        url: `http://${apacheHttpd.hostAddress}:${apacheHttpd.hostPort}/`,
        timeoutMs: apacheHttpd.guest.httpReadyTimeoutMs,
        pollIntervalMs: apacheHttpd.guest.httpReadyPollIntervalMs,
    });
    console.log(`Apache HTTP Server access: OK (http://${apacheHttpd.hostAddress}:${apacheHttpd.hostPort}/)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkApacheHttpdAccess().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
