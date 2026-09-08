'use strict';

const net = require('net');
const { randomUUID } = require('crypto');

// Доказывает не просто listener QEMU на COM2, а готовность SYSTEM
// serial-agent внутри Windows: пока гость грузится, тот же TCP-порт может
// отдавать UEFI boot text, но ещё не принимать наш NDJSON protocol.
class SerialCommandProbe {
    constructor(options) {
        this._options = options;
    }

    async verify_started() {
        const { host, port, timeout_sec, probe_command } = this._options;
        return await new Promise((resolve) => {
            const requestId = randomUUID();
            const socket = net.createConnection({ host, port });
            let buffer = '';
            let settled = false;
            const settle = (result) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(result);
            };
            socket.setTimeout(timeout_sec * 1000, () => settle(false));
            socket.on('error', () => settle(false));
            socket.on('close', () => settle(false));
            socket.on('connect', () => {
                socket.write(`${JSON.stringify({
                    id: requestId,
                    commandBase64: Buffer.from(probe_command, 'utf8').toString('base64'),
                    detach: false,
                })}\n`, 'ascii');
            });
            socket.on('data', (chunk) => {
                buffer += chunk.toString('ascii');
                let newline;
                while ((newline = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newline).trim();
                    buffer = buffer.slice(newline + 1);
                    if (!line) continue;
                    try {
                        const response = JSON.parse(line);
                        if (response.id !== requestId) continue;
                        settle(response.ok === true && response.exitCode === 0);
                    } catch {
                        // UEFI/QEMU diagnostic text before Windows serial-agent
                        // owns COM2 is not a protocol error; wait for a response
                        // or the short per-attempt timeout.
                    }
                }
            });
        });
    }
}

module.exports.SerialCommandProbe = SerialCommandProbe;
