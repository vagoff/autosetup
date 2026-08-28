import path from 'node:path';
import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';

export async function checkApacheHttpdDistribution() {
    const { apacheHttpd } = config;
    await assertArtifactFiles(path.dirname(apacheHttpd.archivePath), [
        {
            filename: apacheHttpd.archiveFilename,
            expectedBytes: apacheHttpd.expectedBytes,
            expectedSha256: apacheHttpd.expectedSha256,
        },
        {
            filename: apacheHttpd.visualCppRuntime.filename,
            expectedBytes: apacheHttpd.visualCppRuntime.expectedBytes,
            expectedSha256: apacheHttpd.visualCppRuntime.expectedSha256,
        },
    ]);
    console.log(`Apache HTTP Server distribution: OK (${apacheHttpd.version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkApacheHttpdDistribution().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
