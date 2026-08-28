import { config } from '../configure.js';
import { assertArtifactFiles } from '../lib/assert-artifact-files.js';

export async function checkOneCPlatformDistribution() {
    const { oneC } = config;
    const files = await assertArtifactFiles(oneC.sourceDirectory, oneC.expectedFiles);
    if (!files.some((file) => file.filename === oneC.transformFilename)) {
        throw new Error(`1C transform is absent from manifest: ${oneC.transformFilename}`);
    }
    console.log(`1C platform distribution: OK (${oneC.version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkOneCPlatformDistribution().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
