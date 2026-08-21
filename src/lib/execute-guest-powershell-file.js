import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

// Для объёмных сценариев -EncodedCommand упирается в лимит командной строки
// SSH/cmd.exe. Файл уже лежит в уникальном staging-каталоге гостя, поэтому
// командная строка остаётся короткой, а PowerShell читает полный сценарий с
// NTFS без обрезания.
export async function executeGuestPowerShellFile(ssh, { localPath, remotePath, argumentsList, label }) {
    await ssh.putFile(localPath, remotePath);
    const argumentsCommand = argumentsList.map(quotePowerShell).join(' ');
    return executeGuestPowerShell(
        ssh,
        `& ${quotePowerShell(remotePath)} ${argumentsCommand}`,
        label,
    );
}
