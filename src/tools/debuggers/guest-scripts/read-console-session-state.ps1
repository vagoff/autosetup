param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 1000)][int] $MaxTerminalServiceEvents
)

$ErrorActionPreference = 'Stop'

function Get-OptionalRegistryValue([string] $Name) {
  try {
    return (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name $Name -ErrorAction Stop).$Name
  } catch {
    return $null
  }
}

function Get-EventLogSnapshot([string] $LogName) {
  try {
    return [ordered]@{
      logName = $LogName
      error = $null
      events = @(Get-WinEvent -LogName $LogName -MaxEvents $MaxTerminalServiceEvents -ErrorAction Stop | ForEach-Object {
        [ordered]@{
          recordId = [string] $_.RecordId
          timeCreated = $_.TimeCreated.ToUniversalTime().ToString('o')
          id = [int] $_.Id
          level = [int] $_.Level
          message = [string] $_.Message
        }
      })
    }
  } catch {
    return [ordered]@{ logName = $LogName; error = $_.Exception.Message; events = @() }
  }
}

$quser = @(& cmd.exe /d /c 'quser 2>&1' | ForEach-Object { [string] $_ })
$services = @('TermService', 'SessionEnv', 'UmRdpService') | ForEach-Object {
  $service = Get-Service -Name $_ -ErrorAction SilentlyContinue
  if ($null -eq $service) { return [ordered]@{ name = $_; status = 'missing'; startType = $null } }
  $cim = Get-CimInstance Win32_Service -Filter "Name='$($_)'" -ErrorAction Stop
  return [ordered]@{ name = $_; status = [string] $service.Status; startType = [string] $cim.StartMode }
}

[ordered]@{
  quser = $quser
  interactiveUser = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
  logonUiProcesses = @(Get-Process -Name 'LogonUI' -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ id = $_.Id; sessionId = $_.SessionId }
  })
  explorerProcesses = @(Get-Process -Name 'explorer' -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ id = $_.Id; sessionId = $_.SessionId }
  })
  autoLogon = [ordered]@{
    autoAdminLogon = Get-OptionalRegistryValue 'AutoAdminLogon'
    defaultUserName = Get-OptionalRegistryValue 'DefaultUserName'
    defaultPasswordPresent = $null -ne (Get-OptionalRegistryValue 'DefaultPassword')
    autoLogonCount = Get-OptionalRegistryValue 'AutoLogonCount'
    forceAutoLogon = Get-OptionalRegistryValue 'ForceAutoLogon'
  }
  rdpServices = @($services)
  terminalServiceEvents = @(
    Get-EventLogSnapshot 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'
    Get-EventLogSnapshot 'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational'
  )
} | ConvertTo-Json -Depth 8 -Compress
