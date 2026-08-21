import path from 'node:path';
import { config } from './config.js';
import { downloadArtifact } from './lib/download-artifact.js';

export async function downloadApacheVisualCppRuntime() {
    const { apacheHttpd, paths } = config;
    const runtime = apacheHttpd.visualCppRuntime;
    await downloadArtifact({
        url: runtime.url,
        targetPath: path.join(paths.vendorDir, 'apache', runtime.filename),
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
