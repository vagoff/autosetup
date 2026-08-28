import { readGuestVolumes } from './lib/read-guest-volumes.js';
import { withGuestSession } from './lib/with-guest-session.js';

export async function dfGuestVolumes() {
    const volumes = await withGuestSession(({ ssh }) => readGuestVolumes(ssh));
    console.table(volumes.map((volume) => ({
        drive: volume.drive,
        filesystem: volume.filesystem,
        label: volume.label,
        sizeGiB: (volume.sizeBytes / 1024 ** 3).toFixed(2),
        usedGiB: (volume.usedBytes / 1024 ** 3).toFixed(2),
        freeGiB: (volume.freeBytes / 1024 ** 3).toFixed(2),
        freePercent: volume.freePercent,
    })));
}

if (import.meta.url === `file://${process.argv[1]}`) dfGuestVolumes().catch((error) => { console.error(error.message); process.exit(1); });
