import { config } from '../configure.js';
import { downloadArtifact } from '../lib/download-artifact.js';

export async function downloadApacheVisualCppRuntime() {
    const runtime = config.apacheHttpd.visualCppRuntime;
    await downloadArtifact({
        url: runtime.url,
        targetPath: runtime.path,
        expectedBytes: runtime.expectedBytes,
        expectedSha256: runtime.expectedSha256,
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    downloadApacheVisualCppRuntime().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
