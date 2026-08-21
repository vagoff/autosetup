import { quotePowerShell } from './execute-guest-powershell.js';

// Единственная реализация "подключиться к файловой ИБ через V83.COMConnector и
// выполнить запрос". Ею пользуются и проба соединения, и запуск произвольного
// запроса -- раньше это был один и тот же PowerShell, скопированный в два
// модуля дословно.
//
// Текст запроса НИКОГДА не попадает в командную строку: он лежит в файле на
// госте (кириллица + лимит длины cmd.exe). queryPath читается как UTF-8.
// Пролог "подключиться к файловой ИБ через внешнее соединение". Общий для
// всех COM-модулей: запросов, пробы соединения, блокировки внешних ресурсов и
// чтения версий подсистем. Строка подключения существует ровно здесь.
export function buildComConnectionScript(oneCConfiguration) {
    const { database } = oneCConfiguration;
    const connectionString = `File="${database.directory}";Usr=${database.userName};Pwd=${database.password};`;
    return [
        '$ErrorActionPreference = "Stop"',
        "$connector = New-Object -ComObject 'V83.COMConnector'",
        `$connection = $connector.Connect(${quotePowerShell(connectionString)})`,
    ];
}

export function buildComQueryScript(oneCConfiguration, { queryPath, maxRows }) {
    return [
        ...buildComConnectionScript(oneCConfiguration),
        `$queryText = [IO.File]::ReadAllText(${quotePowerShell(queryPath)}, [Text.Encoding]::UTF8)`,
        '$query = $connection.NewObject("Query", $queryText)',
        '$result = $query.Execute()',
        '$columns = @($result.Columns | ForEach-Object { $_.Name })',
        '$selection = $result.Select()',
        '$rows = New-Object Collections.ArrayList',
        '$truncated = $false',
        'while ($selection.Next()) {',
        `  if ($rows.Count -ge ${maxRows}) { $truncated = $true; break }`,
        '  $row = [ordered]@{}',
        '  foreach ($column in $columns) {',
        '    $value = $selection[$column]',
        '    $row[$column] = if ($null -eq $value) { "" } elseif ($value -is [string] -or $value -is [bool] -or $value -is [datetime] -or $value -is [valuetype]) { $value } else { [string]$value }',
        '  }',
        '  [void]$rows.Add($row)',
        '}',
        '[ordered]@{ ok = $true; columns = $columns; rows = $rows; truncated = $truncated; error = "" } | ConvertTo-Json -Depth 6 -Compress',
    ].join('\n');
}
