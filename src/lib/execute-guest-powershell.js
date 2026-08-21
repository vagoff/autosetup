// node-ssh передаёт аргумент в удалённую shell-команду. -EncodedCommand
// исключает разъезд кавычек между Node, SSH, cmd.exe и PowerShell и принимает
// ровно UTF-16LE, как требует powershell.exe.
export async function executeGuestPowerShell(ssh, script, label) {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const result = await ssh.execCommand(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`);
    if (result.code !== 0) {
        throw new Error(`${label}: PowerShell exited with ${result.code}: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

export function quotePowerShell(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}
