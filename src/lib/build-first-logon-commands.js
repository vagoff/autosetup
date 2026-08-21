import path from 'node:path';
import { renderGuestScriptTemplate } from './render-guest-script-template.js';
import { encodePowerShellCommand } from './encode-powershell-command.js';
import { GUEST_FEATURE_TOKEN_BUILDERS } from './guest-feature-token-builders.js';
import { buildRegistryPolicyArgumentLine } from './build-registry-policy-commands.js';

// Windows Setup валидирует значение <CommandLine> в FirstLogonCommands и
// отбраковывает ("Value is invalid", видно в C:\Windows\Panther\
// UnattendGC\setuperr.log через oobeldr.exe) слишком длинные строки —
// эмпирически подтверждено: короткие литералы (~150 символов) проходят,
// -EncodedCommand с целым скриптом внутри (~3400-9000 символов) не
// проходят ни разу, вообще ни одна из команд не запускается. Поэтому
// реальное содержимое скриптов едет ФАЙЛАМИ на той же USB-флешке, что и
// autounattend.xml (там нет такого ограничения), а CommandLine — это
// короткий bootstrap: находит букву диска флешки по имени файла и
// запускает его.
function buildBootstrapScript(filename) {
    return `foreach($l in 68..90){$p="$([char]$l):\\${filename}";if(Test-Path $p){& $p;if($?){exit 0}else{exit 1}}};throw "USB script not found: ${filename}"`;
}

// Финальный маркер — core-часть, не привязан ни к одной опциональной
// фиче: выполняется последним из FirstLogonCommands независимо от того,
// какие фичи выбраны в активном профиле (см. лог com1.log —
// "first-logon-commands: ALL DONE" — единственный надёжный сигнал, что
// вся цепочка FirstLogonCommands дошла до конца).
const COMPLETION_MARKER_SCRIPT_FILENAME = 'log-first-logon-complete.ps1';

// Тоже core-часть: выключение Windows Update не принадлежит ни одной
// фиче (обновления способны сломать любую из них) и управляется одним
// флагом base.json5 -> windowsUpdate.disable. Идёт первым: всё остальное
// имеет смысл настраивать только на системе, которая не переделывает
// себя сама у нас за спиной.
const WINDOWS_UPDATE_SCRIPT_FILENAME = 'disable-windows-updates.ps1';

function buildWindowsUpdateTokens(windowsUpdate) {
    return {
        WINDOWS_UPDATE_POLICY_ARGUMENT_LINES_PS_ARRAY: windowsUpdate.policyValues
            .map((value) => `  '${buildRegistryPolicyArgumentLine(value).replaceAll("'", "''")}'`)
            .join(',\n'),
        WINDOWS_UPDATE_SERVICE_NAMES_PS_ARRAY: windowsUpdate.serviceNames
            .map((name) => `'${name.replaceAll("'", "''")}'`)
            .join(', '),
    };
}

// Из config.guestFeatures (упорядоченный по активному профилю список
// включённых фич, каждая — { id, config, guestScripts }) собирает:
//  - scriptFiles: что записать на USB-образ (сами .ps1 с подставленными
//    токенами + общий префикс логирования отдельным файлом, подключается
//    каждым скриптом через $PSScriptRoot — не нужно ничего инлайнить);
//  - firstLogonCommands: короткие CommandLine-строки для unattend.xml.
// Про содержимое токенов конкретной фичи этот модуль ничего не знает —
// это GUEST_FEATURE_TOKEN_BUILDERS (SRP): добавление новой фичи не
// требует правки этого файла.
export function buildFirstLogonCommands({ guestScriptsDir, diagnostics, guestFeatures, firstLogonCompletionLogLine, windowsUpdate }) {
    const preludeTokens = { COM_PORT: diagnostics.comPort, COM_BAUD_RATE: diagnostics.comBaudRate };
    const preludeFilename = '_lib-guest-script-prelude.ps1';
    const preludeContent = renderGuestScriptTemplate(path.join(guestScriptsDir, preludeFilename), preludeTokens);

    const scriptFiles = [{ filename: preludeFilename, content: preludeContent }];
    const firstLogonCommands = [];

    const renderScript = (filename, tokens) => renderGuestScriptTemplate(path.join(guestScriptsDir, filename), tokens);

    if (windowsUpdate.disable) {
        scriptFiles.push({
            filename: WINDOWS_UPDATE_SCRIPT_FILENAME,
            content: renderScript(WINDOWS_UPDATE_SCRIPT_FILENAME, { ...preludeTokens, ...buildWindowsUpdateTokens(windowsUpdate) }),
        });
        firstLogonCommands.push(encodePowerShellCommand(buildBootstrapScript(WINDOWS_UPDATE_SCRIPT_FILENAME)));
    }

    const tokensByFeatureId = new Map();
    for (const feature of guestFeatures) {
        const buildTokens = GUEST_FEATURE_TOKEN_BUILDERS[feature.id];
        if (!buildTokens) throw new Error(`фича "${feature.id}": нет token-builder в src/lib/guest-feature-token-builders.js`);
        tokensByFeatureId.set(feature.id, { ...preludeTokens, ...buildTokens(feature.config) });
    }

    // Сначала ВСЕ firstLogon-скрипты всех фич по порядку профиля, потом
    // маркер завершения, и только потом supporting-скрипты — тот же
    // порядок, что и раньше при плоском unattend.firstLogonScripts +
    // unattend.supportingGuestScripts (порядок байт на USB-образе
    // — не случайное свойство, а сознательно сохранённая совместимость).
    for (const feature of guestFeatures) {
        const tokens = tokensByFeatureId.get(feature.id);
        for (const filename of feature.guestScripts.firstLogon) {
            scriptFiles.push({ filename, content: renderScript(filename, tokens) });
            firstLogonCommands.push(encodePowerShellCommand(buildBootstrapScript(filename)));
        }
    }

    scriptFiles.push({
        filename: COMPLETION_MARKER_SCRIPT_FILENAME,
        content: renderScript(COMPLETION_MARKER_SCRIPT_FILENAME, {
            ...preludeTokens,
            FIRST_LOGON_COMPLETION_LOG_LINE: firstLogonCompletionLogLine,
        }),
    });
    firstLogonCommands.push(encodePowerShellCommand(buildBootstrapScript(COMPLETION_MARKER_SCRIPT_FILENAME)));

    for (const feature of guestFeatures) {
        const tokens = tokensByFeatureId.get(feature.id);
        for (const filename of feature.guestScripts.supporting) {
            scriptFiles.push({ filename, content: renderScript(filename, tokens) });
        }
    }

    return { scriptFiles, firstLogonCommands };
}
