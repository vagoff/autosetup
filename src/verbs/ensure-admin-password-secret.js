import { randomInt } from 'node:crypto';
import { ensure_lines } from '../lib/ensure_lines.js';

// Бутстрап-исключение: этот verb НЕ импортирует '../configure.js'. Он
// существует именно чтобы у configure.js было что читать (unattend.
// adminPassword берётся из process.env.AUTOSETUP_ADMIN_PASSWORD, см.
// configure.js) — импортировать конфиг, который сам ещё не может
// собраться без результата этого скрипта, было бы порочным кругом.
// Путь поэтому захардкожен буквально, как DATA_DIR в configure.js и
// PROFILES_DIR в src/services/run-vm-cli.js.
const SECRETS_PATH = '.env.secrets'; // [!] hack // [!] JSONCFG violation
const KEY = 'AUTOSETUP_ADMIN_PASSWORD';

// Пароль администратора Windows: единственный источник теперь — этот файл,
// не data/base.json5 (не коммитим секрет в git). 6 цифр — сознательный выбор
// (не мой): доступ только с loopback хоста (см. data/vars.json5), локальная
// политика пароля на этом образе не требует сложности (PasswordComplexity=0,
// MinimumPasswordLength=0 — проверено secedit /export на живой системе),
// а короткий цифровой пароль проще набрать руками при интерактивном RDP/
// SPICE-логине.
function generateSixDigitPassword() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Идемпотентно: если строка AUTOSETUP_ADMIN_PASSWORD= уже есть в файле,
// ensure_lines её не трогает — сгенерированный здесь кандидат-пароль в
// этом случае просто отбрасывается. Перезаписывать существующий пароль
// нельзя: он уже мог быть применён на живом госте (см.
// src/verbs/set-guest-admin-password.js).
export async function ensureAdminPasswordSecret() {
    const stats = await ensure_lines(SECRETS_PATH, [
        { check_re: `^${KEY}=`, append: `${KEY}=${generateSixDigitPassword()}` },
    ], { new_file_mode: 'CREATE' });
    console.log(stats.additions > 0
        ? `${KEY}: сгенерирован, записан в ${SECRETS_PATH}`
        : `${KEY}: уже задан в ${SECRETS_PATH}, не трогаю`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    ensureAdminPasswordSecret().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
