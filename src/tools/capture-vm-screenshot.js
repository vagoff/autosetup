import { writeFileSync } from 'node:fs';
import { connectQmp } from '../infrastructure/connect-qmp.js';
import { captureScreendump } from '../infrastructure/capture-screendump.js';
import { ppmToPng } from '../lib/ppm-to-png.js';
import { config } from '../configure.js';

// Одно действие: снять текущий кадр экрана VM и сохранить его как PNG по
// заданному пути — для человека/агента, независимо от того, каким
// протоколом (spice/vnc) в этот момент подключён человек (см.
// data/base.json5 про screendump как отдельный от display канал).
export async function captureVmScreenshot(outputPngPath) {
    const { loopbackHost } = config.network;
    const { qmpPort, qmpConnectTimeoutMs, screendumpPath } = config.qemu;

    const qmp = await connectQmp(loopbackHost, qmpPort, qmpConnectTimeoutMs);
    try {
        const ppm = await captureScreendump(qmp, screendumpPath);
        writeFileSync(outputPngPath, ppmToPng(ppm));
    } finally {
        qmp.disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const outputPngPath = process.argv[2];
    if (!outputPngPath) {
        console.error('использование: node capture-vm-screenshot.js <путь-к-png>');
        process.exit(1);
    }
    captureVmScreenshot(outputPngPath).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
