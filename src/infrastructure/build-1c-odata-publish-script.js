/*
  это был временный обход через V83.COMConnector: он пытался вызвать УстановитьСоставСтандартногоИнтерфейсаOData() из PowerShell/COM.

  Именно этот путь упирался в исходный блокер: API принимает нативный BSL‑массив, а COM маршалит несовместимый тип. Оставлять его как альтернативу означало бы держать заведомо нерабочий второй путь публикации.

  После починки EPF публикация идёт единственным корректным маршрутом: Node → compiled EPF → native BSL → OData composition/user. Поэтому файл стал неиспользуемым и я его удалил.

  Может быть полезен как заготовка для других COM-операций 1С: чтение метаданных, запросы, диагностика пользователей/ролей, вызовы API с простыми COM-совместимыми аргументами.

  Но именно для публикации OData он непригоден: ключевой вызов требует нативный BSL Массив объектов метаданных. COM-массив, включая NewObject("Array"), платформа не принимает. Возвращать файл ради потенциальной
  заготовки не стоит — общие COM-хелперы уже есть в build-1c-com-query-script.js, а этот модуль содержал логику конкретно для неработающего маршрута.

*/
import { buildComConnectionScript, buildComResultEpilogue } from './build-1c-com-query-script.js';
import { quotePowerShell } from './execute-guest-powershell.js';

// COM/IExternalConnection не перечисляет глобальные IDispatch-методы через
// PSObject, но вызывает их штатно. Поэтому состав OData устанавливается
// прямым вызовом, а не ненадёжной интроспекцией списка методов.
export function buildOneCODataPublishScript(oneCConfiguration, { metadataNames, userName, password, roleNames }) {
    const metadata = metadataNames.map(quotePowerShell).join(', ');
    const roles = roleNames.map(quotePowerShell).join(', ');
    return [
        ...buildComConnectionScript(oneCConfiguration),
        'function Set1C($target, $name, $value) { $target.GetType().InvokeMember($name, [Reflection.BindingFlags]::SetProperty, $null, $target, @($value)) }',
        'function Call1C($target, $name, $arguments) { return $target.GetType().InvokeMember($name, [Reflection.BindingFlags]::InvokeMethod, $null, $target, [object[]]$arguments) }',
        'function Find1CByName($collection, $name) { foreach ($candidate in $collection) { if ((Get1C $candidate "Имя") -eq $name) { return $candidate } }; return $null }',
        `$metadataNames = @(${metadata})`,
        '$metadata = Get1C $connection "Метаданные"',
        '$composition = $connection.NewObject("Array")',
        '$metadataIndex = 0',
        'foreach ($metadataName in $metadataNames) {',
        '  $parts = $metadataName.Split(".", 2)',
        '  $collectionName = if ($parts[0] -eq "Документ") { "Документы" } elseif ($parts[0] -eq "Справочник") { "Справочники" } else { throw "Unsupported OData metadata type: $($parts[0])" }',
        '  $collection = Get1C $metadata $collectionName',
        '  $item = Find1CByName $collection $parts[1]',
        '  if ($null -eq $item) { throw "OData metadata object was not found at index $metadataIndex" }',
        '  Call1C $composition "Добавить" @($item) | Out-Null',
        '  $metadataIndex += 1',
        '}',
        'Call1C $connection "УстановитьСоставСтандартногоИнтерфейсаOData" @($composition) | Out-Null',
        '$userManager = Get1C $connection "ПользователиИнформационнойБазы"',
        `$userName = ${quotePowerShell(userName)}`,
        '$user = $null',
        'foreach ($candidate in (Call1C $userManager "ПолучитьПользователей" @())) { if ((Get1C $candidate "Имя") -eq $userName) { $user = $candidate; break } }',
        'if ($null -eq $user) { $user = Call1C $userManager "СоздатьПользователя" @() }',
        'Set1C $user "Имя" $userName',
        'Set1C $user "ПолноеИмя" $userName',
        'Set1C $user "АутентификацияСтандартная" $true',
        'Set1C $user "ПоказыватьВСпискеВыбора" $false',
        `Set1C $user "Пароль" ${quotePowerShell(password)}`,
        '$userRoles = Get1C $user "Роли"',
        'Call1C $userRoles "Очистить" @() | Out-Null',
        `$roleNames = @(${roles})`,
        'foreach ($roleName in $roleNames) {',
        '  $role = Find1CByName $rolesMetadata $roleName',
        '  if ($null -eq $role) { throw "OData role was not found: $roleName" }',
        '  Call1C $userRoles "Добавить" @($role) | Out-Null',
        '}',
        'Call1C $user "Записать" @() | Out-Null',
        ...buildComResultEpilogue('[ordered]@{ ok = $true; metadataNames = $metadataNames; user = $userName; roles = $roleNames; error = "" }'),
    ].join('\n').replace('$roleNames = @(', '$rolesMetadata = Get1C $metadata "Роли"\n$roleNames = @(');
}
