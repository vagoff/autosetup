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
  return `foreach($l in 68..90){$p="$([char]$l):\\${filename}";if(Test-Path $p){& $p;exit}}`;
}

// Из firstLogonScripts (имена файлов в src/guest-scripts/) собирает:
//  - scriptFiles: что записать на USB-образ (сами .ps1 с подставленными
//    токенами + общий префикс логирования отдельным файлом, подключается
//    каждым скриптом через $PSScriptRoot — не нужно ничего инлайнить);
//  - firstLogonCommands: короткие CommandLine-строки для unattend.xml.
export function buildFirstLogonCommands({ guestScriptsDir, firstLogonScripts, diagnostics }) {
  const preludeFilename = '_lib-guest-script-prelude.ps1';
  const preludeContent = renderGuestScriptTemplate(path.join(guestScriptsDir, preludeFilename), {
    COM_PORT: diagnostics.comPort,
  });

  const networkProbeTargetsPs = diagnostics.networkProbeTargets
    .map((t) => `  [pscustomobject]@{ Host = '${t.host}'; Port = ${t.port}; Label = '${t.label}' }`)
    .join(',\n');

  const scriptFiles = [{ filename: preludeFilename, content: preludeContent }];
  const firstLogonCommands = [];

  for (const filename of firstLogonScripts) {
    const content = renderGuestScriptTemplate(path.join(guestScriptsDir, filename), {
      NETWORK_PROBE_TARGETS_PS_ARRAY: networkProbeTargetsPs,
      NETWORK_PROBE_TIMEOUT_SECONDS: diagnostics.networkProbeTimeoutSeconds,
      CAPABILITY_PROBE_TIMEOUT_SECONDS: diagnostics.capabilityProbeTimeoutSeconds,
    });
    scriptFiles.push({ filename, content });
    firstLogonCommands.push(encodePowerShellCommand(buildBootstrapScript(filename)));
  }

  return { scriptFiles, firstLogonCommands };
}
