import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NodeSSH } from 'node-ssh';
import { config } from '../configure.js';
import { renderGuestScriptTemplate } from '../lib/render-guest-script-template.js';

// Обновляет только serial-agent уже работающей Windows через проверенный
// SSH. Сначала кладёт новый файл в уникальный временный путь, затем одной
// PowerShell-командой заменяет установленный script и перезапускает ровно
// процессы, чей CommandLine ссылается на этот script.
export async function updateSerialCommandAgent() {
    const { network, unattend, openSsh, serialAgent, paths } = config;
    const localScriptPath = path.join(paths.guestScriptsDir, serialAgent.scriptFilename);
    const renderedScript = renderGuestScriptTemplate(localScriptPath, {
        SERIAL_AGENT_COM_PORT: serialAgent.comPort,
        SERIAL_AGENT_COM_BAUD_RATE: serialAgent.comBaudRate,
        SERIAL_AGENT_INSTALLATION_DIRECTORY_NAME: serialAgent.installationDirectoryName,
        SERIAL_AGENT_LOG_FILENAME: serialAgent.logFilename,
        SERIAL_AGENT_TASK_NAME: serialAgent.taskName,
        SERIAL_AGENT_COMMAND_TIMEOUT_MS: serialAgent.commandTimeoutMs,
        SERIAL_AGENT_MAX_RESPONSE_BYTES: serialAgent.maxResponseBytes,
    });
    const remoteDirectory = `C:\\ProgramData\\${serialAgent.installationDirectoryName}`;
    const remoteScriptPath = `${remoteDirectory}\\${serialAgent.scriptFilename}`;
    const remoteStagedPath = `${remoteScriptPath}.next`;
    const sftpStagedPath = remoteStagedPath.replaceAll('\\', '/');
    const localStagedPath = path.join(paths.vmCacheDir, `${serialAgent.scriptFilename}.next`);
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
        writeFileSync(localStagedPath, renderedScript);
        await ssh.putFile(localStagedPath, sftpStagedPath);
        const updateScript = [
            `$target = '${remoteScriptPath}'`,
            `$staged = '${remoteStagedPath}'`,
            `Stop-ScheduledTask -TaskName '${serialAgent.taskName}' -ErrorAction SilentlyContinue`,
            `$deadline = [DateTime]::UtcNow.AddMilliseconds(${serialAgent.taskStopTimeoutMs})`,
            `while ((Get-ScheduledTask -TaskName '${serialAgent.taskName}').State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }`,
            `if ((Get-ScheduledTask -TaskName '${serialAgent.taskName}').State -eq 'Running') { throw 'serial agent task did not stop before deadline' }`,
            'Move-Item -LiteralPath $staged -Destination $target -Force',
            `Start-ScheduledTask -TaskName '${serialAgent.taskName}' -ErrorAction Stop`,
        ].join('; ');
        // node-ssh execCommand принимает raw command text, поэтому передаём
        // PowerShell без shell quoting через UTF-16LE EncodedCommand.
        const encoded = Buffer.from(updateScript, 'utf16le').toString('base64');
        const execution = await ssh.execCommand(`powershell.exe -NoProfile -EncodedCommand ${encoded}`);
        if (execution.code !== 0) {
            throw new Error(`serial agent update failed: ${execution.stderr || execution.stdout}`);
        }
        console.log('serial command agent: updated');
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    updateSerialCommandAgent().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
