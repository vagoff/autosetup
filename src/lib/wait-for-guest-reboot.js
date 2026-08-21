import { connectGuestSsh } from './connect-guest-ssh.js';
import { executeGuestPowerShell } from './execute-guest-powershell.js';

async function getBootTime(ssh) {
    return (await executeGuestPowerShell(
        ssh,
        '(Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")',
        'read guest boot time',
    )).trim();
}

function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Ожидание не основано на «Windows обычно грузится N секунд»: условие
// завершения — другой LastBootUpTime, deadline — только предохранитель.
export async function restartGuestAndWait(ssh, { timeoutMs, reconnectIntervalMs }) {
    const previousBootTime = await getBootTime(ssh);
    const restart = await ssh.execCommand('shutdown.exe /r /t 0 /f');
    if (restart.code !== 0) throw new Error(`request guest reboot: ${restart.stderr || restart.stdout}`);
    ssh.dispose();

    const deadline = Date.now() + timeoutMs;
    let lastError = 'SSH did not reconnect';
    while (Date.now() < deadline) {
        let candidate;
        try {
            candidate = await connectGuestSsh();
            const bootTime = await getBootTime(candidate);
            if (bootTime !== previousBootTime) return candidate;
            candidate.dispose();
        } catch (error) {
            lastError = error.message;
            candidate?.dispose();
        }
        await wait(reconnectIntervalMs);
    }
    throw new Error(`guest did not return from reboot within ${timeoutMs}ms: ${lastError}`);
}
