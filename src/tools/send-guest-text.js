import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { config } from '../configure.js';
import { connectQmp } from '../infrastructure/connect-qmp.js';
import { encodeQmpTextKeys } from '../infrastructure/encode-qmp-text-keys.js';

async function readText(argv) {
    if (argv.length === 2 && argv[0] === '--text') return argv[1];
    if (argv.length === 2 && argv[0] === '--file') return readFile(argv[1], 'utf8');
    if (argv.length === 1 && argv[0] === '--stdin') {
        let text = '';
        process.stdin.setEncoding('utf8');
        for await (const chunk of process.stdin) text += chunk;
        return text;
    }
    throw new Error('usage: node src/tools/send-guest-text.js --text <text> | --file <utf8-file> | --stdin');
}

export async function sendGuestText(argv = process.argv.slice(2)) {
    const events = encodeQmpTextKeys(await readText(argv));
    const qmp = await connectQmp(config.network.loopbackHost, config.qemu.qmpPort);
    try {
        for (const keys of events) await qmp.execute('send-key', { keys });
    } finally {
        qmp.disconnect();
    }
    console.log(`sent ${events.length} key events through QMP`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sendGuestText().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
