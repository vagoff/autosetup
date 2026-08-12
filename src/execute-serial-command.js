import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

function connectSerialPort({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`COM1 TCP ${host}:${port}: не подключился за ${timeoutMs}мс`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`COM1 TCP ${host}:${port}: ${error.message}`));
    });
  });
}

// Выполняет одну CMD-команду через serial command agent. Аргумент командной
// строки — явный ввод оператора, а все transport-параметры — из JSON5.
export async function executeSerialCommand(commandText) {
  if (!commandText) {
    throw new Error('нужен один аргумент: CMD-команда для serial command agent');
  }
  const { network, qemu, serialAgent } = config;
  const socket = await connectSerialPort({
    host: network.loopbackHost,
    port: qemu.serialTcpPort,
    timeoutMs: serialAgent.commandTimeoutMs,
  });
  const requestId = randomUUID();
  const request = {
    id: requestId,
    commandBase64: Buffer.from(commandText, 'utf8').toString('base64'),
  };

  try {
    const response = await new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`serial command ${requestId}: нет ответа за ${serialAgent.commandTimeoutMs}мс`));
      }, serialAgent.commandTimeoutMs);

      socket.on('data', (chunk) => {
        buffer += chunk.toString('ascii');
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            process.stderr.write(`COM1: ${line}\n`);
            continue;
          }
          if (message.id !== requestId) {
            process.stderr.write(`COM1: unexpected response id ${message.id}\n`);
            continue;
          }
          clearTimeout(timeout);
          resolve(message);
        }
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`serial command ${requestId}: ${error.message}`));
      });
      socket.once('close', () => {
        clearTimeout(timeout);
        reject(new Error(`serial command ${requestId}: COM1 TCP connection closed before response`));
      });
      socket.write(`${JSON.stringify(request)}\n`, 'ascii');
    });

    const output = Buffer.concat([
      Buffer.from(response.stdoutBase64 || '', 'base64'),
      Buffer.from(response.stderrBase64 || '', 'base64'),
    ]);
    process.stdout.write(output);
    if (!response.ok) {
      throw new Error(response.error || `serial command timed out after ${serialAgent.commandTimeoutMs}ms`);
    }
    if (response.exitCode !== 0) {
      throw new Error(`serial command exited with code ${response.exitCode}`);
    }
    console.log('serial command: OK');
  } finally {
    socket.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  executeSerialCommand(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
