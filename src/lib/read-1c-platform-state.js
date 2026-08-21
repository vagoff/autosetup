import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

function buildStateScript(oneC) {
    const requiredFiles = oneC.requiredInstalledFiles
        .map((file) => quotePowerShell(file))
        .join(', ');
    return [
        '$ErrorActionPreference = "Stop"',
        `$productCode = ${quotePowerShell(oneC.productCode)}`,
        `$installationDirectory = ${quotePowerShell(oneC.installationDirectory)}`,
        `$requiredFiles = @(${requiredFiles})`,
        '$uninstallKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$productCode"',
        '$entry = if (Test-Path -LiteralPath $uninstallKey) { Get-ItemProperty -LiteralPath $uninstallKey } else { $null }',
        '$files = @{}',
        'foreach ($relativePath in $requiredFiles) { $files[$relativePath] = Test-Path -LiteralPath (Join-Path $installationDirectory $relativePath) -PathType Leaf }',
        '[ordered]@{',
        '  registered = ($null -ne $entry)',
        '  displayVersion = if ($entry) { [string]$entry.DisplayVersion } else { $null }',
        '  installationDirectoryExists = Test-Path -LiteralPath $installationDirectory -PathType Container',
        '  files = $files',
        '} | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function readOneCPlatformState(ssh, oneC) {
    const output = await executeGuestPowerShell(ssh, buildStateScript(oneC), 'read 1C platform state');
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`read 1C platform state: invalid JSON from guest: ${error.message}: ${output}`);
    }
}

export function isOneCPlatformInstalled(state, oneC) {
    return state.registered
        && state.displayVersion === oneC.version
        && state.installationDirectoryExists
        && oneC.requiredInstalledFiles.every((file) => state.files[file] === true);
}
