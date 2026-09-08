param()

$ErrorActionPreference = 'Stop'

$activeSchemeLines = @(powercfg.exe /getactivescheme 2>&1 | ForEach-Object { [string] $_ })
$activeScheme = [ordered]@{ exitCode = $LASTEXITCODE; lines = $activeSchemeLines }
$activeGuidMatch = [regex]::Match(($activeScheme.lines -join "\n"), '[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
$activeSchemeGuid = if ($activeGuidMatch.Success) { $activeGuidMatch.Value } else { $null }
if ($null -eq $activeSchemeGuid) { throw 'powercfg /getactivescheme did not return a scheme GUID' }

# SUB_BUTTONS and PBUTTONACTION aliases are not expanded by this LTSC build
# when passed to /query. These are Microsoft-defined scheme GUIDs.
$buttonActionLines = @(powercfg.exe /query $activeSchemeGuid 4f971e89-eebd-4455-a8de-9e59040e7347 7648efa3-dd9c-4e3e-b566-50f929386280 2>&1 | ForEach-Object { [string] $_ })
$buttonAction = [ordered]@{ exitCode = $LASTEXITCODE; lines = $buttonActionLines }
$fullQueryLines = @(powercfg.exe /query $activeSchemeGuid 2>&1 | ForEach-Object { [string] $_ })
$fullQueryExitCode = $LASTEXITCODE
$settingGuid = '7648efa3-dd9c-4e3e-b566-50f929386280'
$settingStart = [Array]::FindIndex([string[]] $fullQueryLines, [Predicate[string]] { param($line) $line -match [regex]::Escape($settingGuid) })
$settingLines = if ($settingStart -lt 0) {
  @()
} else {
  @($fullQueryLines[$settingStart..($fullQueryLines.Count - 1)] | Select-Object -First 12)
}
$acValueLine = @($settingLines | Where-Object { $_ -match 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)' }) | Select-Object -Last 1
$dcValueLine = @($settingLines | Where-Object { $_ -match 'Current DC Power Setting Index:\s+0x([0-9a-fA-F]+)' }) | Select-Object -Last 1

function Get-PowerValue($line) {
  if ($line -match '0x([0-9a-fA-F]+)') { return [Convert]::ToInt32($Matches[1], 16) }
  return $null
}

function Get-RegistryTree([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [ordered]@{ path = $Path; exists = $false; entries = @() } }
  $entries = @()
  foreach ($key in @((Get-Item -LiteralPath $Path), (Get-ChildItem -LiteralPath $Path -Recurse -ErrorAction Stop))) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
    $values = [ordered]@{}
    foreach ($property in $properties.PSObject.Properties) {
      if ($property.Name -notmatch '^PS') { $values[$property.Name] = $property.Value }
    }
    $entries += [ordered]@{ path = $key.Name; values = $values }
  }
  return [ordered]@{ path = $Path; exists = $true; entries = $entries }
}

$actionNames = @{
  0 = 'do-nothing'
  1 = 'sleep'
  2 = 'hibernate'
  3 = 'shut-down'
}
$acValue = Get-PowerValue $acValueLine
$dcValue = Get-PowerValue $dcValueLine
$subgroupGuid = '4f971e89-eebd-4455-a8de-9e59040e7347'
$registryPath = if ($null -eq $activeSchemeGuid) { $null } else { "HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\$activeSchemeGuid\$subgroupGuid\$settingGuid" }
$registryValue = if ($null -eq $registryPath -or -not (Test-Path -LiteralPath $registryPath)) {
  $null
} else {
  Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
}
if ($null -eq $acValue -and $null -ne $registryValue) { $acValue = $registryValue.ACSettingIndex }
if ($null -eq $dcValue -and $null -ne $registryValue) { $dcValue = $registryValue.DCSettingIndex }

[ordered]@{
  activeScheme = $activeScheme
  powerButtonAction = [ordered]@{
    acValue = $acValue
    acAction = if ($null -eq $acValue) { $null } else { $actionNames[$acValue] }
    dcValue = $dcValue
    dcAction = if ($null -eq $dcValue) { $null } else { $actionNames[$dcValue] }
    powercfgQuery = $buttonAction
    powercfgFullQuery = [ordered]@{ exitCode = $fullQueryExitCode; powerButtonSettingLines = $settingLines }
    registry = [ordered]@{
      path = $registryPath
      exists = $null -ne $registryValue
      acSettingIndex = if ($null -eq $registryValue) { $null } else { $registryValue.ACSettingIndex }
      dcSettingIndex = if ($null -eq $registryValue) { $null } else { $registryValue.DCSettingIndex }
    }
    policyRegistry = @(
      Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Power'
      Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System\Power'
      Get-RegistryTree 'HKLM:\SOFTWARE\Microsoft\PolicyManager\current\device\Power'
    )
  }
} | ConvertTo-Json -Depth 8 -Compress
