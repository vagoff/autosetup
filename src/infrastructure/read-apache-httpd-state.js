import path from 'node:path';
import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

export async function readApacheHttpdState(ssh, apacheHttpd) {
    const httpdPath = path.win32.join(apacheHttpd.installationDirectory, 'bin', 'httpd.exe');
    const script = [
        '$ErrorActionPreference = "Stop"',
        `$httpdPath = ${quotePowerShell(httpdPath)}`,
        `$serviceName = ${quotePowerShell(apacheHttpd.serviceName)}`,
        '$exists = Test-Path -LiteralPath $httpdPath -PathType Leaf',
        '$version = if ($exists) { (& $httpdPath -v 2>&1 | Out-String).Trim() } else { $null }',
        '$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue',
        '[ordered]@{',
        '  exists = $exists',
        '  version = $version',
        '  serviceExists = ($null -ne $service)',
        '  serviceStatus = if ($service) { [string]$service.Status } else { $null }',
        '} | ConvertTo-Json -Compress',
    ].join('\n');
    const output = await executeGuestPowerShell(ssh, script, 'read Apache HTTP Server state');
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`read Apache HTTP Server state: invalid JSON from guest: ${error.message}: ${output}`);
    }
}

export function isApacheHttpdInstalled(state, apacheHttpd) {
    return state.exists
        && state.version.includes(`Server version: Apache/${apacheHttpd.version}`)
        && state.serviceExists
        && state.serviceStatus === 'Running';
}
