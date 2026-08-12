import path from 'node:path';
import { renderGuestScriptTemplate } from './render-guest-script-template.js';
import { encodePowerShellCommand } from './encode-powershell-command.js';

// Windows Setup валидирует значение <CommandLine> в FirstLogonCommands и
// отбраковывает ("Value is invalid", видно в C:\Windows\Panther\
// UnattendGC\setuperr.log через oobeldr.exe) слишком длинные строки —
// эмпирически подтверждено: короткие литералы (~150 символов) проходят,
// -EncodedCommand с целым скриптом внутри (~3400-9000 символов) не
// проходят ни разу, вообще ни одна из команд не запускается. Поэтому
// реальное содержимое скриптов едет ФАЙЛАМИ на той же USB-флешке, что и
// autounattend.xml (там нет такого ограничения), а CommandLine — это
// короткий bootstrap: находит букву диска флешки по имени файла и
// запускает его.
function buildBootstrapScript(filename) {
  return `foreach($l in 68..90){$p="$([char]$l):\\${filename}";if(Test-Path $p){& $p;if($?){exit 0}else{exit 1}}};throw "USB script not found: ${filename}"`;
}

// Из firstLogonScripts (имена файлов в src/guest-scripts/) собирает:
//  - scriptFiles: что записать на USB-образ (сами .ps1 с подставленными
//    токенами + общий префикс логирования отдельным файлом, подключается
//    каждым скриптом через $PSScriptRoot — не нужно ничего инлайнить);
//  - firstLogonCommands: короткие CommandLine-строки для unattend.xml.
export function buildFirstLogonCommands({
  guestScriptsDir,
  firstLogonScripts,
  supportingGuestScripts,
  diagnostics,
  openSsh,
  serialAgent,
  winRm,
}) {
  const preludeFilename = '_lib-guest-script-prelude.ps1';
  const preludeContent = renderGuestScriptTemplate(path.join(guestScriptsDir, preludeFilename), {
    COM_PORT: diagnostics.comPort,
    COM_BAUD_RATE: diagnostics.comBaudRate,
  });

  const networkProbeTargetsPs = diagnostics.networkProbeTargets
    .map((t) => `  [pscustomobject]@{ Host = '${t.host}'; Port = ${t.port}; Label = '${t.label}' }`)
    .join(',\n');

  const scriptFiles = [{ filename: preludeFilename, content: preludeContent }];
  const firstLogonCommands = [];

  const renderScript = (filename) => renderGuestScriptTemplate(path.join(guestScriptsDir, filename), {
    COM_PORT: diagnostics.comPort,
    COM_BAUD_RATE: diagnostics.comBaudRate,
    NETWORK_PROBE_TARGETS_PS_ARRAY: networkProbeTargetsPs,
    NETWORK_PROBE_TIMEOUT_SECONDS: diagnostics.networkProbeTimeoutSeconds,
    CAPABILITY_PROBE_TIMEOUT_SECONDS: diagnostics.capabilityProbeTimeoutSeconds,
    OPENSSH_ARCHIVE_FILENAME: openSsh.archiveFilename,
    OPENSSH_INSTALLATION_DIRECTORY_NAME: openSsh.installationDirectoryName,
    OPENSSH_SERVICE_NAME: openSsh.serviceName,
    OPENSSH_FIREWALL_RULE_NAME: openSsh.firewallRuleName,
    OPENSSH_FIREWALL_RULE_DISPLAY_NAME: openSsh.firewallRuleDisplayName,
    OPENSSH_PORT: openSsh.port,
    OPENSSH_ADMIN_AUTHORIZED_KEYS_FILENAME: openSsh.adminAuthorizedKeysFilename,
    OPENSSH_CLIENT_PUBLIC_KEY_FILENAME: openSsh.clientPublicKeyFilename,
    SERIAL_AGENT_SCRIPT_FILENAME: serialAgent.scriptFilename,
    SERIAL_AGENT_INSTALLATION_DIRECTORY_NAME: serialAgent.installationDirectoryName,
    SERIAL_AGENT_LOG_FILENAME: serialAgent.logFilename,
    SERIAL_AGENT_TASK_NAME: serialAgent.taskName,
    SERIAL_AGENT_COMMAND_TIMEOUT_MS: serialAgent.commandTimeoutMs,
    SERIAL_AGENT_MAX_RESPONSE_BYTES: serialAgent.maxResponseBytes,
    WINRM_LOCAL_ACCOUNT_TOKEN_FILTER_POLICY_VALUE: winRm.localAccountTokenFilterPolicyValue,
  });

  for (const filename of firstLogonScripts) {
    scriptFiles.push({ filename, content: renderScript(filename) });
    firstLogonCommands.push(encodePowerShellCommand(buildBootstrapScript(filename)));
  }
  for (const filename of supportingGuestScripts) {
    scriptFiles.push({ filename, content: renderScript(filename) });
  }

  return { scriptFiles, firstLogonCommands };
}
