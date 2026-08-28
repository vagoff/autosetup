import { config } from '../configure.js';
import { buildComConnectionScript, buildComResultEpilogue, parseComResult } from '../infrastructure/build-1c-com-query-script.js';
import { executeGuestPowerShell, quotePowerShell } from '../infrastructure/execute-guest-powershell.js';
import { withGuestSession } from '../infrastructure/with-guest-session.js';

// Одно проверяемое действие: пометить восстановленную ИБ как КОПИЮ, заблокировав
// работу с внешними ресурсами. Это программный ответ на модальный вопрос БСП
// "база скопирована или перемещена" -- см. data/1c-configuration.json5 ->
// externalResourcesLock и doc/1c-usage.md.
//
// Обязано выполняться ПОСЛЕ restore-1c-infobase.js и ДО первого запуска
// клиента 1С, иначе вопрос успеет заблокировать пакетный запуск.
//
// Идемпотентно: если блокировка уже стоит, повторный вызов ничего не меняет.
function buildScript(oneCConfiguration) {
    const { externalResourcesLock } = oneCConfiguration;
    const module = '$bspModule';
    return [
        ...buildComConnectionScript(oneCConfiguration),
        `$bspModule = Get1C $connection ${quotePowerShell(externalResourcesLock.moduleName)}`,
        `$before = [bool]${module}.${externalResourcesLock.stateMethodName}()`,
        `if (-not $before) { ${module}.${externalResourcesLock.lockMethodName}() | Out-Null }`,
        `$after = [bool]${module}.${externalResourcesLock.stateMethodName}()`,
        'if (-not $after) { throw "1C external resources are still unlocked after locking the infobase copy" }',
        ...buildComResultEpilogue('[ordered]@{ ok = $true; alreadyLocked = $before; locked = $after }'),
    ].join('\n');
}

export async function lockOneCInfobaseExternalResources() {
    const { oneCConfiguration } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildScript(oneCConfiguration),
        'lock 1C infobase external resources',
    ));
    const result = parseComResult(output);
    if (result.ok !== true) throw new Error(`invalid 1C external resources lock result: ${output}`);
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    lockOneCInfobaseExternalResources().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
