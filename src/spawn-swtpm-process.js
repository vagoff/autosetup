import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { config } from './config.js';

function waitForPort(port, host, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`не дождался tcp-порта ${host}:${port}`));
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

// Запускает swtpm (виртуальный TPM 2.0) с control-каналом по tcp/loopback
// (unix-сокеты не используем — alpine и obarun делят сетевое пространство,
// пробрасывать нечего, tcp одинаково доступен обеим сторонам). Дожидается
// готовности порта, прежде чем отдать управление вызывающему.
export async function spawnSwtpmProcess() {
  const { stateDir, ctrlPort, binary } = config.tpm;
  if (!existsSync(stateDir)) {
    throw new Error(`нет TPM state dir: ${stateDir}. Сначала запусти create-vm-resources.js`);
  }

  const child = spawn(
    binary,
    [
      'socket', '--tpm2',
      '--tpmstate', `dir=${stateDir}`,
      '--ctrl', `type=tcp,port=${ctrlPort},bindaddr=127.0.0.1`,
    ],
    { stdio: 'inherit' }
  );

  const spawnFailure = new Promise((_, reject) => {
    child.on('error', (error) => reject(new Error(`не смог запустить ${binary}: ${error.message}`)));
  });

  await Promise.race([waitForPort(ctrlPort, '127.0.0.1', 10000), spawnFailure]);
  return child;
}
