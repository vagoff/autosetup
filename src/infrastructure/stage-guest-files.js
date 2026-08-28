import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

export async function removeGuestDirectory(ssh, directoryPath) {
    await executeGuestPowerShell(
        ssh,
        `Remove-Item -LiteralPath ${quotePowerShell(directoryPath)} -Recurse -Force -ErrorAction SilentlyContinue`,
        `remove guest directory ${directoryPath}`,
    );
}

function buildVerificationScript(remoteDirectory, files) {
    const items = files.map((file) => (
        `[pscustomobject]@{ Path = ${quotePowerShell(`${remoteDirectory}\\${file.filename}`)}; Bytes = ${file.expectedBytes}; Sha256 = ${quotePowerShell(file.expectedSha256)} }`
    )).join(',\n');
    return [
        '$ErrorActionPreference = "Stop"',
        `$files = @(${items})`,
        'foreach ($file in $files) {',
        '  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) { throw "staged artifact is missing: $($file.Path)" }',
        '  if ((Get-Item -LiteralPath $file.Path).Length -ne $file.Bytes) { throw "staged artifact size mismatch: $($file.Path)" }',
        '  $actual = (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash.ToLowerInvariant()',
        '  if ($actual -ne $file.Sha256) { throw "staged artifact SHA-256 mismatch: $($file.Path)" }',
        '}',
    ].join('\n');
}

// Доставляет все файлы в свежий уникальный каталог, потом проверяет их уже
// на NTFS гостя. Частичная/битая загрузка никогда не подаётся установщику.
export async function stageGuestFiles(ssh, { stagingRoot, files }) {
    const remoteDirectory = path.win32.join(stagingRoot, randomUUID());
    await executeGuestPowerShell(
        ssh,
        `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${quotePowerShell(remoteDirectory)} -Force | Out-Null`,
        `create guest staging directory ${remoteDirectory}`,
    );
    try {
        for (const file of files) {
            await ssh.putFile(file.filePath, path.win32.join(remoteDirectory, file.filename));
        }
        await executeGuestPowerShell(ssh, buildVerificationScript(remoteDirectory, files), `verify guest staging ${remoteDirectory}`);
        return remoteDirectory;
    } catch (error) {
        await removeGuestDirectory(ssh, remoteDirectory).catch(() => {});
        throw error;
    }
}
