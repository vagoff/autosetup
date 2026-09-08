'use strict';

const net = require('net');
const { randomUUID } = require('crypto');

// Вежливый shutdown Windows через уже установленный SYSTEM serial-agent на
// COM2. В отличие от QMP system_powerdown это не ACPI-button policy, а
// однозначная команда shutdown.exe внутри самого гостя.
class SerialCommandGraceful {
    constructor(options) {
        this._options = options;
    }

    async polite_stop() {
        const { host, port, timeout_sec, command } = this._options;
        return await new Promise((resolve) => {
            const requestId = randomUUID();
            const socket = net.createConnection({ host, port });
            let buffer = '';
            let settled = false;
            const settle = (state) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(state);
            };
            socket.setTimeout(timeout_sec * 1000, () => settle('timeout'));
            socket.on('error', (error) => settle(error.code === 'ECONNREFUSED' ? 'refused' : 'error'));
            socket.on('close', () => settle('closed'));
            socket.on('connect', () => {
                socket.write(`${JSON.stringify({
                    id: requestId,
                    commandBase64: Buffer.from(command, 'utf8').toString('base64'),
                    detach: true,
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
                        settle(response.ok === true && response.detached === true ? 'accepted' : 'rejected');
                    } catch {
                        settle('malformed');
                    }
                }
            });
        });
    }
}

module.exports.SerialCommandGraceful = SerialCommandGraceful;
