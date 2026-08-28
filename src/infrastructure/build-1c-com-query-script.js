import { quotePowerShell } from './execute-guest-powershell.js';

// Пролог "подключиться к файловой ИБ через внешнее соединение". Общий для всех
// COM-модулей: запросов, пробы, блокировки внешних ресурсов, чтения версий.
// Строка подключения существует ровно здесь.
export function buildComConnectionScript(oneCConfiguration) {
    const { database } = oneCConfiguration;
    const connectionString = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connectionString)})`,
        // Адаптер COM в PowerShell НЕ видит свойства объектов 1С: $connection.Метаданные
        // и $connection.<ОбщийМодуль> молча возвращают $null (проверено живым
        // запуском -- не ошибка, а именно null). Методы при этом вызываются
        // нормально. Поэтому любое ЧТЕНИЕ СВОЙСТВА идёт только через Get1C.
        'function Get1C($target, $name) { return $target.GetType().InvokeMember($name, [Reflection.BindingFlags]::GetProperty, $null, $target, $null) }',
    ];
}

// Результат возвращается base64 от UTF-8, а НЕ обычным текстом.
//
// Причина конкретная: с systemLocale=ru-RU консоль гостя имеет OEMCP 866, и
// stdout с кириллицей приходит в 866, тогда как node-ssh читает его как UTF-8.
// Любое имя колонки, синоним или текст ошибки по-русски превращались бы в
// мусор. base64 выносит данные из-под кодовой страницы целиком -- тем же
// приёмом, что уже применён в src/guest-scripts/run-1c-query.ps1.
export function buildComResultEpilogue(objectExpression) {
    return [
        `$payload = ${objectExpression} | ConvertTo-Json -Depth 6 -Compress`,
        '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))',
    ];
}

export function parseComResult(output) {
    return JSON.parse(Buffer.from(output.trim(), 'base64').toString('utf8'));
}

// Значения выборки читаются ТОЛЬКО по индексу через Get(i).
//
// Строковый индексатор $selection[$columnName] в PowerShell не работает:
// COM-объект 1С не публикует его, и обращение падает с
// "Error while invoking [PROPERTYGET, DISPID(0)]. Could not find member".
// Доступ по имени свойства ($selection.Значение) тоже ненадёжен, потому что
// имена колонок в этой конфигурации кириллические. Get(i) проверен живым
// запуском и работает без оговорок.
//
// Имена колонок читаются через foreach, а НЕ через Колонки.Count()/Get(i).
// КоллекцияКолонокРезультатаЗапроса — устроена иначе, чем строки выборки:
// метод .Count() падает с "does not contain a method named 'Count'", а
// InvokeMember("Количество", ..., GetProperty/InvokeMethod, ...) — с
// DISP_E_UNKNOWNNAME на обоих связываниях. Это НЕ значит, что коллекция
// вообще не доступна из COM: она реализует стандартный перечислитель
// IEnumVARIANT, и foreach по ней читает элементы штатно (проверено живым
// запуском). Индексированный доступ к этой конкретной коллекции недоступен —
// только перечисление.
export function buildComQueryScript(oneCConfiguration, { queryPath, maxRows }) {
    return [
        ...buildComConnectionScript(oneCConfiguration),
        `$queryText = [IO.File]::ReadAllText(${quotePowerShell(queryPath)}, [Text.Encoding]::UTF8)`,
        '$query = $connection.NewObject("Query", $queryText)',
        '$result = $query.Execute()',
        '$columnCollection = Get1C $result "Колонки"',
        '$columns = @()',
        'foreach ($column in $columnCollection) { $columns += [string](Get1C $column "Имя") }',
        '$selection = $result.Выбрать()',
        '$rows = New-Object Collections.ArrayList',
        '$truncated = $false',
        'while ($selection.Next()) {',
        `  if ($rows.Count -ge ${maxRows}) { $truncated = $true; break }`,
        '  $row = [ordered]@{}',
        '  for ($i = 0; $i -lt $columns.Count; $i++) {',
        '    $value = $selection.Get($i)',
        '    $row[$columns[$i]] = if ($null -eq $value) { "" } elseif ($value -is [string] -or $value -is [bool] -or $value -is [datetime] -or $value -is [valuetype]) { $value } else { [string]$value }',
        '  }',
        '  [void]$rows.Add($row)',
        '}',
        ...buildComResultEpilogue('[ordered]@{ ok = $true; columns = $columns; rows = $rows; truncated = $truncated; error = "" }'),
    ].join('\n');
}
