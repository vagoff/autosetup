import { config } from './config.js';
import { buildComConnectionScript, buildComResultEpilogue, parseComResult } from './lib/build-1c-com-query-script.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Проверяет ровно те API платформы, на которых строится отдельный модуль
// публикации: состав стандартного OData, менеджер пользователей ИБ и роли
// конфигурации. Никаких объектов и настроек этот probe не меняет.
export function buildOneCODataApiProbeScript(oneCConfiguration) {
    return [
        ...buildComConnectionScript(oneCConfiguration),
        '$metadata = Get1C $connection "Метаданные"',
        '$roles = Get1C $metadata "Роли"',
        '$roleNames = @()',
        'foreach ($role in $roles) { $roleNames += [string](Get1C $role "Имя") }',
        '$documents = Get1C $metadata "Документы"',
        '$documentNames = @()',
        'foreach ($document in $documents) { if ($documentNames.Count -ge 10) { break }; $documentNames += [string](Get1C $document "Имя") }',
        '$userManager = Get1C $connection "ПользователиИнформационнойБазы"',
        '$users = $userManager.ПолучитьПользователей()',
        '$userNames = @()',
        'foreach ($user in $users) { $userNames += [string](Get1C $user "Имя") }',
        // IDispatch внешнего соединения не перечисляет глобальные методы,
        // поэтому это только диагностическое наблюдение. Каноническая
        // проверка/вызов состава OData выполняется внутри EPF-публикатора.
        '$odataMethod = $connection.PSObject.Methods["УстановитьСоставСтандартногоИнтерфейсаOData"]',
        ...buildComResultEpilogue('[ordered]@{ ok = $true; standardODataCompositionMethod = ($null -ne $odataMethod); userManagerGetUsers = ($null -ne $users); roleNames = $roleNames; documentNames = $documentNames; userNames = $userNames; error = "" }'),
    ].join('\n');
}

export async function probeOneCODataApi() {
    const { oneCConfiguration } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildOneCODataApiProbeScript(oneCConfiguration),
        'probe 1C OData APIs',
    ));
    const result = parseComResult(output);
    if (result.ok !== true) throw new Error(`invalid 1C OData API probe result: ${output}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    probeOneCODataApi().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
