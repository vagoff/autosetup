import { setGuestAdminPassword } from '../set-guest-admin-password.js';
import { setGuestAutoLogonCredentials } from '../set-guest-auto-logon-credentials.js';

// Тонкий порядок двух независимых состояний одного admin credential:
// сначала пароль в SAM, потом зависящий от него Winlogon AutoLogon.
export async function syncGuestAdminCredentials() {
    await setGuestAdminPassword();
    await setGuestAutoLogonCredentials();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncGuestAdminCredentials().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
