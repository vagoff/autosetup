import { config } from './config.js';
import { buildComConnectionScript, buildComResultEpilogue, parseComResult } from './lib/build-1c-com-query-script.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Одно проверяемое действие: прочитать версии конфигурации и её встроенных
// библиотек, прежде всего БСП. Нужно потому, что имена методов БСП между
// версиями меняются, а весь наш модуль блокировки внешних ресурсов
// (lock-1c-infobase-external-resources.js) опирается ровно на такое имя.
//
// Заодно проверяет, что объявленный в конфиге метод БСП реально существует:
// stateMethodName -- getter без побочных эффектов, поэтому его безопасно
// вызвать just to see. Это превращает "я надеюсь, имя правильное" в
// наблюдаемый факт.
//
// Кириллица в тексте скрипта безопасна: executeGuestPowerShell передаёт его
// через -EncodedCommand в UTF-16LE, минуя ANSI code page гостя.
function buildScript(oneCConfiguration) {
    const { subsystemVersions, externalResourcesLock } = oneCConfiguration;
    // Запрос с ЯВНЫМИ полями и одной колонкой -- намеренно.
    //
    // Интроспекция колонок результата через COM здесь невозможна: объекты,
    // полученные рефлексией, приходят сырыми System.__ComObject, у которых
    // коллекция колонок не отвечает ни на Count(), ни на Количество().
    // Городить рефлексию на каждый член графа объектов 1С -- версионно
    // зависимый хак; вместо этого спрашиваем ровно одно значение и читаем
    // его позиционным Get(0), который проверен живым запуском.
    const queryText = [
        `ВЫБРАТЬ ${subsystemVersions.versionFieldName} КАК Version`,
        `ИЗ РегистрСведений.${subsystemVersions.registerName}`,
        `ГДЕ ${subsystemVersions.subsystemFieldName} = "${subsystemVersions.standardSubsystemsName}"`,
    ].join(' ');
    return [
        ...buildComConnectionScript(oneCConfiguration),
        '$metadata = Get1C $connection "Метаданные"',
        `$query = $connection.NewObject("Query", ${quotePowerShell(queryText)})`,
        // Только по одному вызову на выражение: результат Execute() приходит
        // сырым COM-объектом, и цепочка .Execute().Select() падает с
        // NullReferenceException. Промежуточная переменная это чинит.
        '$queryResult = $query.Execute()',
        '$selection = $queryResult.Select()',
        '$bspVersion = ""',
        'if ($selection.Next()) { $bspVersion = [string]$selection.Get(0) }',
        `$bspModule = Get1C $connection ${quotePowerShell(externalResourcesLock.moduleName)}`,
        `$lockApi = [ordered]@{ module = ${quotePowerShell(externalResourcesLock.moduleName)}; method = ${quotePowerShell(externalResourcesLock.stateMethodName)}; available = $false; locked = $null; error = "" }`,
        'try {',
        `  $lockApi.locked = [bool]$bspModule.${externalResourcesLock.stateMethodName}()`,
        '  $lockApi.available = $true',
        '} catch { $lockApi.error = $_.Exception.Message }',
        ...buildComResultEpilogue([
            '[ordered]@{',
            'configurationName = [string](Get1C $metadata "Имя");',
            'configurationSynonym = [string](Get1C $metadata "Синоним");',
            'configurationVersion = [string](Get1C $metadata "Версия");',
            'configurationVendor = [string](Get1C $metadata "Поставщик");',
            'standardSubsystemsVersion = $bspVersion;',
            'externalResourcesLockApi = $lockApi',
            '}',
        ].join(' ')),
    ].join('\n');
}

export async function readOneCSubsystemVersions() {
    const { oneCConfiguration } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildScript(oneCConfiguration),
        'read 1C subsystem versions',
    ));
    const report = parseComResult(output);
    console.log(JSON.stringify(report, null, 2));

    if (!report.standardSubsystemsVersion) {
        throw new Error(`subsystem "${oneCConfiguration.subsystemVersions.standardSubsystemsName}" was not found in register ${oneCConfiguration.subsystemVersions.registerName}`);
    }
    if (report.externalResourcesLockApi.available !== true) {
        throw new Error(`configured BSP API is not callable: ${report.externalResourcesLockApi.module}.${report.externalResourcesLockApi.method}: ${report.externalResourcesLockApi.error}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readOneCSubsystemVersions().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
