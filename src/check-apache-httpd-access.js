import { config } from './config.js';
import { waitForHttp } from './lib/wait-for-http.js';

export async function checkApacheHttpdAccess() {
    const { apacheHttpd, network } = config;
    await waitForHttp({
        url: `http://${network.loopbackHost}:${apacheHttpd.hostPort}/`,
        timeoutMs: apacheHttpd.guest.httpReadyTimeoutMs,
        pollIntervalMs: apacheHttpd.guest.httpReadyPollIntervalMs,
    });
    console.log(`Apache HTTP Server access: OK (http://${network.loopbackHost}:${apacheHttpd.hostPort}/)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkApacheHttpdAccess().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
