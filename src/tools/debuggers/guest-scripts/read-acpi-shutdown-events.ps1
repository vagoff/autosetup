param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 168)][int] $LookbackHours,
  [Parameter(Mandatory = $true)][ValidateRange(1, 1000)][int] $MaxRecordsPerLog
)

$ErrorActionPreference = 'Stop'
$startTime = (Get-Date).AddHours(-$LookbackHours)

$queries = @(
  [ordered]@{
    name = 'System-power-and-shutdown'
    logName = 'System'
    # Не ограничиваем IDs: у разных сборок Windows одна и та же ACPI
    # цепочка пишет разные Kernel-Power/UserModePowerService события. Раньше
    # фильтр оставлял только финальные 41/1074/6006 и мог скрыть сам факт
    # доставки power-button до гостя.
    providerNames = @(
      'Microsoft-Windows-Kernel-General',
      'Microsoft-Windows-Kernel-Power',
      'Microsoft-Windows-Kernel-Boot',
      'Microsoft-Windows-UserModePowerService',
      'Microsoft-Windows-Power-Troubleshooter',
      'USER32',
      'EventLog'
    )
  },
  [ordered]@{
    name = 'Application-hang'
    logName = 'Application'
    providerNames = @('Application Hang', 'Windows Error Reporting')
    ids = @(1001, 1002)
  }
)

function Convert-Event($event) {
  [xml] $xml = $event.ToXml()
  $data = @()
  foreach ($node in @($xml.Event.EventData.Data)) {
    if ($null -ne $node) {
      $data += [ordered]@{ name = [string] $node.Name; value = [string] $node.InnerText }
    }
  }
  return [ordered]@{
    recordId = [string] $event.RecordId
    timeCreated = $event.TimeCreated.ToUniversalTime().ToString('o')
    provider = [string] $event.ProviderName
    id = [int] $event.Id
    level = [int] $event.Level
    message = [string] $event.Message
    data = $data
  }
}

$result = @()
foreach ($query in $queries) {
  try {
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = $query.logName; StartTime = $startTime } -ErrorAction Stop |
      Where-Object { $_.ProviderName -in $query.providerNames } |
      Select-Object -First $MaxRecordsPerLog)
    $result += [ordered]@{
      name = $query.name
      logName = $query.logName
      events = @($events | ForEach-Object { Convert-Event $_ })
      error = $null
    }
  } catch {
    $result += [ordered]@{
      name = $query.name
      logName = $query.logName
      events = @()
      error = $_.Exception.Message
    }
  }
}

[ordered]@{
  lookbackHours = $LookbackHours
  startTime = $startTime.ToUniversalTime().ToString('o')
  queries = $result
} | ConvertTo-Json -Depth 8 -Compress
