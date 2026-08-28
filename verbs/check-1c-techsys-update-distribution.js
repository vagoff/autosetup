import { config } from './config.js';
import { assertArtifactFiles } from './lib/assert-artifact-files.js';

export async function checkOneCTechsysUpdateDistribution() {
    const { oneCTechsysUpdate } = config;
    await assertArtifactFiles(oneCTechsysUpdate.sourceDirectory, [{
        filename: oneCTechsysUpdate.filename,
        expectedBytes: oneCTechsysUpdate.expectedBytes,
        expectedSha256: oneCTechsysUpdate.expectedSha256,
    }]);
    console.log('1C techsys update distribution: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCTechsysUpdateDistribution().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
