import { config } from './config.js';
import { buildComConnectionScript } from './lib/build-1c-com-query-script.js';
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
    const queryText = `ВЫБРАТЬ * ИЗ РегистрСведений.${subsystemVersions.registerName}`;
    return [
        ...buildComConnectionScript(oneCConfiguration),
        '$metadata = $connection.Метаданные',
        '$versions = New-Object Collections.ArrayList',
        `$query = $connection.NewObject("Query", ${quotePowerShell(queryText)})`,
        '$result = $query.Execute()',
        '$columns = @($result.Columns | ForEach-Object { $_.Name })',
        '$selection = $result.Select()',
        'while ($selection.Next()) {',
        '  $row = [ordered]@{}',
        '  foreach ($column in $columns) { $row[$column] = [string]$selection[$column] }',
        '  [void]$versions.Add($row)',
        '}',
        // Проба объявленного метода БСП: существует ли он вообще под этим именем.
        '$lockApi = [ordered]@{ module = ' + quotePowerShell(externalResourcesLock.moduleName) + '; method = ' + quotePowerShell(externalResourcesLock.stateMethodName) + '; available = $false; locked = $null; error = "" }',
        'try {',
        `  $lockApi.locked = [bool]$connection.${externalResourcesLock.moduleName}.${externalResourcesLock.stateMethodName}()`,
        '  $lockApi.available = $true',
        '} catch { $lockApi.error = $_.Exception.Message }',
        '[ordered]@{',
        '  configurationName = [string]$metadata.Имя',
        '  configurationSynonym = [string]$metadata.Синоним',
        '  configurationVersion = [string]$metadata.Версия',
        '  configurationVendor = [string]$metadata.Поставщик',
        '  subsystemVersions = $versions',
        '  externalResourcesLockApi = $lockApi',
        '} | ConvertTo-Json -Depth 6 -Compress',
    ].join('\n');
}

// Имя колонки версии/подсистемы не угадываем: берём ту пару колонок регистра,
// в которой значение совпадает с искомым именем подсистемы.
function findStandardSubsystemsVersion(rows, standardSubsystemsName) {
    for (const row of rows) {
        const entries = Object.entries(row);
        if (!entries.some(([, value]) => value === standardSubsystemsName)) continue;
        const version = entries.find(([, value]) => /^\d+(\.\d+)+$/u.test(value));
        if (version) return version[1];
    }
    return null;
}

export async function readOneCSubsystemVersions() {
    const { oneCConfiguration } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildScript(oneCConfiguration),
        'read 1C subsystem versions',
    ));
    const report = JSON.parse(output);
    const rows = Array.isArray(report.subsystemVersions) ? report.subsystemVersions : [report.subsystemVersions].filter(Boolean);
    const bspVersion = findStandardSubsystemsVersion(rows, oneCConfiguration.subsystemVersions.standardSubsystemsName);

    console.log(JSON.stringify({ ...report, subsystemVersions: rows, standardSubsystemsVersion: bspVersion }, null, 2));

    if (!bspVersion) {
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
