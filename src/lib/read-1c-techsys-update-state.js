import { executeGuestPowerShell, quotePowerShell } from './execute-guest-powershell.js';

function buildStateScript(update) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$targetPath = ${quotePowerShell(update.targetPath)}`,
        `$backupPath = ${quotePowerShell(update.backupPath)}`,
        '$hash = { param([string]$path) if (Test-Path -LiteralPath $path -PathType Leaf) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null } }',
        '[ordered]@{',
        '  targetExists = Test-Path -LiteralPath $targetPath -PathType Leaf',
        '  targetSha256 = & $hash $targetPath',
        '  backupExists = Test-Path -LiteralPath $backupPath -PathType Leaf',
        '  backupSha256 = & $hash $backupPath',
        '} | ConvertTo-Json -Compress',
    ].join('\n');
}

export async function readOneCTechsysUpdateState(ssh, update) {
    const output = await executeGuestPowerShell(ssh, buildStateScript(update), 'read 1C techsys update state');
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`read 1C techsys update state: invalid JSON from guest: ${error.message}: ${output}`);
    }
}

export function isOneCTechsysUpdateInstalled(state, update) {
    return state.targetSha256 === update.expectedSha256
        && state.backupSha256 === update.expectedOriginalSha256;
}
