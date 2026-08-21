import path from 'node:path';
import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

// Одно проверяемое действие: сделать поведение firewall гостя по отношению к
// 1С детерминированным, чтобы Windows никогда не показывала модальный запрос
// "разрешить программе доступ в сеть". Таблица правил -- в
// data/1c-platform.json5 -> firewall, здесь только её применение.
//
// Идемпотентно: правило пересоздаётся, а не дублируется при повторном запуске.
function buildScript(oneC) {
    const { firewall } = oneC;
    const rules = firewall.inboundBlockRules.map((rule) => (
        `[pscustomobject]@{ Name = ${quotePowerShell(rule.name)}; DisplayName = ${quotePowerShell(rule.displayName)}; Program = ${quotePowerShell(path.win32.join(oneC.installationDirectory, rule.programRelativePath))} }`
    )).join(',\n');
    return [
        '$ErrorActionPreference = "Stop"',
        ...(firewall.suppressListenNotifications
            // NotifyOnListen -- это GpoBoolean (True/False/NotConfigured),
            // а не [bool]: $false тут не приводится и падает.
            ? ['Set-NetFirewallProfile -Profile Domain,Private,Public -NotifyOnListen False -ErrorAction Stop']
            : []),
        `$rules = @(${rules})`,
        'foreach ($rule in $rules) {',
        '  if (-not (Test-Path -LiteralPath $rule.Program -PathType Leaf)) { throw "1C executable is missing: $($rule.Program)" }',
        '  Remove-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue',
        '  New-NetFirewallRule -Name $rule.Name -DisplayName $rule.DisplayName -Direction Inbound -Action Block -Program $rule.Program -Profile Any -Enabled True -ErrorAction Stop | Out-Null',
        '}',
        '$applied = @(Get-NetFirewallRule -Name $rules.Name -ErrorAction Stop)',
        'if ($applied.Count -ne $rules.Count) { throw "expected $($rules.Count) 1C firewall rules, found $($applied.Count)" }',
        `[ordered]@{ ok = $true; ruleCount = $applied.Count; notifyOnListen = ${firewall.suppressListenNotifications ? '$false' : '$true'} } | ConvertTo-Json -Compress`,
    ].join('\n');
}

export async function createOneCFirewallRules() {
    const { oneC } = config;
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(ssh, buildScript(oneC), 'create 1C firewall rules'));
    const result = JSON.parse(output);
    if (result.ok !== true) throw new Error(`invalid 1C firewall rule result: ${output}`);
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createOneCFirewallRules().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
