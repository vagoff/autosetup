import { config } from '../configure.js';
import { connectGuestSsh } from '../infrastructure/connect-guest-ssh.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';

// Синхронизирует только Winlogon AutoAdminLogon с уже объявленными
// credentials. SAM учётной записи намеренно не меняет: это отдельное
// действие set-guest-admin-password.js. Так ротированный секрет не оставит
// физическую console session на экране логина после следующей загрузки.
export async function setGuestAutoLogonCredentials() {
    const { unattend } = config;
    if (!unattend.enableAutoLogon) {
        throw new Error('unattend.enableAutoLogon=false: синхронизировать AutoLogon запрещено конфигом');
    }
    const script = [
        "$ErrorActionPreference = 'Stop'",
        "$winlogon = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'",
        `Set-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '1' -Type String`,
        `Set-ItemProperty -Path $winlogon -Name 'DefaultUserName' -Value ${quotePowerShell(unattend.adminUsername)} -Type String`,
        `Set-ItemProperty -Path $winlogon -Name 'DefaultPassword' -Value ${quotePowerShell(unattend.adminPassword)} -Type String`,
        `Set-ItemProperty -Path $winlogon -Name 'AutoLogonCount' -Value ${quotePowerShell(String(unattend.autoLogonCount))} -Type String`,
    ].join('; ');
    const ssh = await connectGuestSsh();
    try {
        await executeGuestPowerShell(ssh, script, 'set guest auto logon credentials');
        console.log(`AutoLogon для ${unattend.adminUsername} синхронизирован (count=${unattend.autoLogonCount})`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    setGuestAutoLogonCredentials().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
