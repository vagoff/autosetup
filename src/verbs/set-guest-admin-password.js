import { config } from '../configure.js';
import { connectGuestSsh } from '../infrastructure/connect-guest-ssh.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';

// Переводит локальный пароль administrator-учётки уже РАБОТАЮЩЕГО гостя на
// текущее значение config.unattend.adminPassword (.env.secrets). Нужен
// ровно тогда, когда секрет сменился/сгенерирован ПОСЛЕ того, как Windows
// уже установлена (unattend.xml применяет пароль только один раз, при самой
// установке) — иначе конфиг и SAM гостя расходятся, и WinRM/RDP-логин
// перестаёт совпадать с тем, что думает конфиг.
//
// Идемпотентно: установка того же пароля второй раз — безопасный no-op по
// эффекту (Set-LocalUser не проверяет историю паролей, см. data/base.json5
// -> unattend, PasswordHistorySize=0 на этом образе).
//
// Соединение — по SSH-ключу (openssh feature), от текущего пароля учётки не
// зависит, поэтому работает даже если пароль в SAM уже разошёлся с конфигом.
export async function setGuestAdminPassword() {
    const { unattend } = config;
    const ssh = await connectGuestSsh();
    try {
        const script = `Set-LocalUser -Name ${quotePowerShell(unattend.adminUsername)} -Password (ConvertTo-SecureString -AsPlainText -Force ${quotePowerShell(unattend.adminPassword)})`;
        await executeGuestPowerShell(ssh, script, 'set-guest-admin-password');
        console.log(`пароль учётки ${unattend.adminUsername} на госте синхронизирован с .env.secrets`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    setGuestAdminPassword().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
