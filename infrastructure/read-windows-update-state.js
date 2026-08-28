import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

function buildStateScript(windowsUpdate) {
    const policyItems = windowsUpdate.policyValues
        .map((value) => `[pscustomobject]@{ Path = ${quotePowerShell(`Registry::${value.path}`)}; Name = ${quotePowerShell(value.name)}; Expected = ${JSON.stringify(value.data)} }`)
        .join(', ');
    const serviceNames = windowsUpdate.serviceNames.map((name) => quotePowerShell(name)).join(', ');
    return [
        '$ErrorActionPreference = "Stop"',
        `$policyValues = @(${policyItems})`,
        `$serviceNames = @(${serviceNames})`,
        '$policies = @()',
        'foreach ($value in $policyValues) {',
        '  $item = Get-ItemProperty -LiteralPath $value.Path -Name $value.Name -ErrorAction SilentlyContinue',
        '  $policies += [ordered]@{ path = $value.Path; name = $value.Name; expected = $value.Expected; actual = if ($item) { $item.($value.Name) } else { $null } }',
        '}',
        '$services = @()',
        'foreach ($serviceName in $serviceNames) {',
        '  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue',
        '  $services += [ordered]@{ name = $serviceName; exists = ($null -ne $service); startType = if ($service) { [string]$service.StartType } else { $null }; status = if ($service) { [string]$service.Status } else { $null } }',
        '}',
        '[ordered]@{ policies = $policies; services = $services } | ConvertTo-Json -Depth 4 -Compress',
    ].join('\n');
}

export async function readWindowsUpdateState(ssh, windowsUpdate) {
    const output = await executeGuestPowerShell(ssh, buildStateScript(windowsUpdate), 'read Windows Update state');
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`read Windows Update state: invalid JSON from guest: ${error.message}: ${output}`);
    }
}

// Расхождения возвращаются списком, а не одним булевым «не так»: причина
// отказа должна быть видна сразу, без второго захода в гостя руками.
export function findWindowsUpdateDeviations(state) {
    const deviations = [];
    for (const policy of state.policies) {
        if (policy.actual !== policy.expected) {
            deviations.push(`policy ${policy.path}\\${policy.name}: ${JSON.stringify(policy.actual)} != ${JSON.stringify(policy.expected)}`);
        }
    }
    for (const service of state.services) {
        if (!service.exists) {
            deviations.push(`service ${service.name}: does not exist`);
            continue;
        }
        if (service.startType !== 'Disabled') deviations.push(`service ${service.name}: startType=${service.startType}`);
        if (service.status !== 'Stopped') deviations.push(`service ${service.name}: status=${service.status}`);
    }
    return deviations;
}
