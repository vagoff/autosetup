import { executeGuestPowerShell } from './execute-guest-powershell.js';

export function buildReadGuestVolumesScript() {
    return [
        '$ErrorActionPreference = "Stop"',
        '$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" | ForEach-Object {',
        '  if ($_.Size -le 0) { throw "guest volume has invalid size: $($_.DeviceID)" }',
        '  [pscustomobject]@{',
        '    drive = [string]$_.DeviceID',
        '    label = [string]$_.VolumeName',
        '    filesystem = [string]$_.FileSystem',
        '    sizeBytes = [int64]$_.Size',
        '    usedBytes = [int64]$_.Size - [int64]$_.FreeSpace',
        '    freeBytes = [int64]$_.FreeSpace',
        '    freePercent = [Math]::Round(([double]$_.FreeSpace / [double]$_.Size) * 100, 2)',
        '  }',
        '} | Sort-Object drive)',
        'if ($volumes.Count -eq 0) { throw "guest has no fixed logical volumes" }',
        '$volumes | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function readGuestVolumes(ssh) {
    const output = await executeGuestPowerShell(ssh, buildReadGuestVolumesScript(), 'read guest volumes');
    const volumes = JSON.parse(output);
    const result = Array.isArray(volumes) ? volumes : [volumes];
    if (result.some((volume) => !Number.isSafeInteger(volume.sizeBytes) || volume.sizeBytes <= 0 || !Number.isSafeInteger(volume.freeBytes) || volume.freeBytes < 0)) {
        throw new Error(`invalid guest volume state: ${output}`);
    }
    return result;
}
