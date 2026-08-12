import { existsSync } from 'node:fs';
import { NodeSSH } from 'node-ssh';
import { config } from './config.js';

// Проверяет настоящий login SSH с хоста в гостя по ключу, а не только
// открытый TCP-порт. Использует уже установленный node-ssh, поэтому
// проверка не зависит от наличия системного ssh binary в Alpine.
export async function checkSshAccess() {
  const { openSsh, network, unattend } = config;
  if (!existsSync(openSsh.clientPrivateKeyPath)) {
    throw new Error(`нет SSH private key: ${openSsh.clientPrivateKeyPath}. Сначала запусти create-ssh-client-key.js`);
  }
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: network.loopbackHost,
      port: openSsh.hostPort,
      username: unattend.adminUsername,
      privateKeyPath: openSsh.clientPrivateKeyPath,
      readyTimeout: openSsh.check.connectTimeoutSeconds * 1000,
      tryKeyboard: false,
    });
    const result = await ssh.execCommand(openSsh.check.remoteCommand);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.code !== 0) throw new Error(`SSH remote command exited with code ${result.code}`);
    console.log('SSH login: OK');
  } finally {
    ssh.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkSshAccess().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
