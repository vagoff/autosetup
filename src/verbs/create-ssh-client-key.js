import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../configure.js';
import { formatRsaPublicKey } from '../lib/format-rsa-public-key.js';

// Создаёт постоянный ключ именно для автоматического входа host → guest.
// Это stateful-ресурс VM, поэтому существующий ключ — ошибка, а не повод
// тихо переиспользовать или перезаписать секрет.
export function createSshClientKey() {
    const { openSsh } = config;
    const keyPaths = [openSsh.clientPrivateKeyPath, openSsh.clientPublicKeyPath];
    const existingPath = keyPaths.find(existsSync);
    if (existingPath) {
        throw new Error(`SSH client key уже существует: ${existingPath}. Не перезаписываю stateful-секрет.`);
    }
    if (openSsh.clientKeyAlgorithm !== 'rsa') {
        throw new Error(`неподдерживаемый openSsh.clientKeyAlgorithm: ${openSsh.clientKeyAlgorithm}`);
    }

    mkdirSync(path.dirname(openSsh.clientPrivateKeyPath), { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: openSsh.clientKeyBits,
        publicKeyEncoding: { format: 'jwk' },
        // node-ssh (ssh2) принимает traditional PKCS#1 PEM, а публичная
        // часть и сам RSA-ключ от этого формата не меняются.
        privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    });
    const publicKeyText = formatRsaPublicKey(publicKey, openSsh.clientKeyComment);

    writeFileSync(openSsh.clientPrivateKeyPath, privateKey, { mode: 0o600 });
    writeFileSync(openSsh.clientPublicKeyPath, publicKeyText, { mode: 0o644 });
    console.log(`создан SSH client key: ${openSsh.clientPrivateKeyPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        createSshClientKey();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
