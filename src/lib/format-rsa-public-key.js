function encodeSshField(data) {
    const value = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
}

function encodeUnsignedMpint(base64Url) {
    let value = Buffer.from(base64Url, 'base64url');
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
    return encodeSshField(value);
}

// Node экспортирует RSA public key как JWK (n/e в base64url), а OpenSSH
// ожидает свой wire-format: type + exponent mpint + modulus mpint.
export function formatRsaPublicKey({ n, e }, comment) {
    if (!n || !e) throw new Error('RSA JWK не содержит modulus или exponent');
    const blob = Buffer.concat([
        encodeSshField('ssh-rsa'),
        encodeUnsignedMpint(e),
        encodeUnsignedMpint(n),
    ]);
    return `ssh-rsa ${blob.toString('base64')} ${comment}\n`;
}
