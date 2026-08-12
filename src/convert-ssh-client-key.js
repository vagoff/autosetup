import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';

// Конвертирует существующий PEM-контейнер private key в PKCS#1 без
// генерации нового ключевого материала: public key в госте остаётся
// действующим, меняется только совместимость с node-ssh.
export function convertSshClientKey() {
  const { clientPrivateKeyPath } = config.openSsh;
  if (!existsSync(clientPrivateKeyPath)) {
    throw new Error(`нет SSH private key: ${clientPrivateKeyPath}`);
  }
  const privateKey = createPrivateKey(readFileSync(clientPrivateKeyPath));
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error(`ожидался RSA private key, получен ${privateKey.asymmetricKeyType}`);
  }
  writeFileSync(clientPrivateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs1' }), { mode: 0o600 });
  console.log(`SSH private key converted to PKCS#1: ${clientPrivateKeyPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    convertSshClientKey();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
