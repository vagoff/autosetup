import { config } from './config.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Одно проверяемое действие: гость реально получил локаль, объявленную в
// data/base.json5 -> unattend. Проверяется именно ACP/OEMCP, а не только имя
// локали: от кодовой страницы зависит, увидит ли 1С кириллицу в путях или
// "???????????????" (см. doc/1c-usage.md).
//
// Ожидаемые кодовые страницы выводятся из systemLocale, а не задаются
// отдельным ключом: дублировать "ru-RU это 1251" в конфиге -- значит завести
// второй источник правды, который рано или поздно разойдётся с первым.
const CODE_PAGES_BY_LOCALE = {
    'ru-RU': { acp: '1251', oemcp: '866' },
    'en-US': { acp: '1252', oemcp: '437' },
};

export async function checkGuestSystemLocale() {
    const { unattend } = config;
    const expected = CODE_PAGES_BY_LOCALE[unattend.systemLocale];
    if (!expected) throw new Error(`unknown expected code pages for systemLocale=${unattend.systemLocale}`);

    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, [
        '$ErrorActionPreference = "Stop"',
        '$codePage = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage"',
        '[ordered]@{ acp = $codePage.ACP; oemcp = $codePage.OEMCP; systemLocale = (Get-WinSystemLocale).Name } | ConvertTo-Json -Compress',
    ].join('\n'), 'read guest system locale'));

    const actual = JSON.parse(output);
    const problems = [];
    if (actual.systemLocale !== unattend.systemLocale) problems.push(`systemLocale=${actual.systemLocale}, expected ${unattend.systemLocale}`);
    if (actual.acp !== expected.acp) problems.push(`ACP=${actual.acp}, expected ${expected.acp}`);
    if (actual.oemcp !== expected.oemcp) problems.push(`OEMCP=${actual.oemcp}, expected ${expected.oemcp}`);
    if (problems.length > 0) throw new Error(`guest system locale mismatch: ${problems.join('; ')}`);

    console.log(`guest system locale: OK (${actual.systemLocale}, ACP=${actual.acp}, OEMCP=${actual.oemcp})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkGuestSystemLocale().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
