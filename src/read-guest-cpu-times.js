import { config } from './config.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// GetSystemTimes возвращает накопленные 100-нс интервалы с последней загрузки
// Windows. Busy = Kernel + User - Idle — суммарное процессорное время по всем
// логическим CPU, поэтому разность двух снимков измеряет стоимость операции.
export function buildGuestCpuTimesScript() {
    return [
        '$ErrorActionPreference = "Stop"',
        'Add-Type @"',
        'using System; using System.Runtime.InteropServices;',
        'public static class AutoSetupCpuTimes {',
        '  [DllImport("kernel32.dll", SetLastError=true)]',
        '  public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);',
        '}',
        '"@',
        '$idle = [long]0; $kernel = [long]0; $user = [long]0',
        'if (-not [AutoSetupCpuTimes]::GetSystemTimes([ref]$idle, [ref]$kernel, [ref]$user)) { throw "GetSystemTimes failed" }',
        '$boot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime',
        '[ordered]@{ bootTime = $boot.ToUniversalTime().ToString("o"); idleCpuSeconds = [math]::Round($idle / 10000000.0, 3); kernelCpuSeconds = [math]::Round($kernel / 10000000.0, 3); userCpuSeconds = [math]::Round($user / 10000000.0, 3); busyCpuSeconds = [math]::Round(($kernel + $user - $idle) / 10000000.0, 3) } | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function readGuestCpuTimes() {
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, buildGuestCpuTimesScript(), 'read guest cumulative CPU times'));
    const result = JSON.parse(output);
    if (result.busyCpuSeconds < 0) throw new Error(`guest CPU time is invalid: ${output}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readGuestCpuTimes().catch((error) => { console.error(error.message); process.exit(1); });
}
