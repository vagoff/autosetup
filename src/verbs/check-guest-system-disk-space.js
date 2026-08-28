import { config } from './config.js';
import { readGuestVolumes } from './lib/read-guest-volumes.js';
import { withGuestSession } from './lib/with-guest-session.js';

export async function checkGuestSystemDiskSpace() {
    const guestSystemDisk = config.diagnostics.guestSystemDisk;
    const volumes = await withGuestSession(({ ssh }) => readGuestVolumes(ssh));
    const minFreeBytes = guestSystemDisk.minFreeGiB * 1024 ** 3;
    const lowVolumes = volumes.filter((volume) => volume.freeBytes < minFreeBytes || volume.freePercent < guestSystemDisk.minFreePercent);
    if (lowVolumes.length > 0) {
        throw new Error(`guest fixed volume is low: ${JSON.stringify(lowVolumes)}; required freeGiB>=${guestSystemDisk.minFreeGiB}, freePercent>=${guestSystemDisk.minFreePercent}`);
    }
    console.log(`Guest fixed volume space: OK (${volumes.map((volume) => `${volume.drive} ${(volume.freeBytes / 1024 ** 3).toFixed(2)} GiB ${volume.freePercent}%`).join(', ')})`);
}

if (import.meta.url === `file://${process.argv[1]}`) checkGuestSystemDiskSpace().catch((error) => { console.error(error.message); process.exit(1); });
