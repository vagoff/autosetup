import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { executeGuestPowerShell, quotePowerShell } from './lib/execute-guest-powershell.js';
import { hashFileSha256 } from './lib/hash-file-sha256.js';
import { parseSendGuestTextFileArguments } from './lib/parse-send-guest-text-file-arguments.js';
import { withGuestSession, withGuestStaging } from './lib/with-guest-session.js';

async function stageFile(filePath, filename) {
    const source = await stat(filePath);
    if (!source.isFile()) throw new Error(`text input is not a file: ${filePath}`);
    return {
        filePath,
        filename,
        expectedBytes: source.size,
        expectedSha256: await hashFileSha256(filePath),
    };
}

function buildInteractiveScriptRunner(scriptPath, inputPath, taskName, guestTextInput) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$scriptPath = ${quotePowerShell(scriptPath)}`,
        `$inputPath = ${quotePowerShell(inputPath)}`,
        `$taskName = ${quotePowerShell(taskName)}`,
        `$timeoutSeconds = ${guestTextInput.interactiveTaskTimeoutSeconds}`,
        `$pollMilliseconds = ${guestTextInput.interactiveTaskPollMilliseconds}`,
        '$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`" `"$inputPath`""',
        '$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments',
        '$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Highest',
        'Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null',
        'try {',
        '  $startedAt = Get-Date',
        '  Start-ScheduledTask -TaskName $taskName',
        '  $deadline = $startedAt.AddSeconds($timeoutSeconds)',
        '  while ($true) {',
        '    $task = Get-ScheduledTask -TaskName $taskName',
        '    $info = Get-ScheduledTaskInfo -TaskName $taskName',
        '    if ($info.LastRunTime -ge $startedAt -and $task.State -ne "Running") {',
        '      if ($info.LastTaskResult -ne 0) { throw "interactive guest text task failed with $($info.LastTaskResult)" }',
        '      [ordered]@{ ok = $true; taskName = $taskName } | ConvertTo-Json -Compress',
        '      break',
        '    }',
        '    if ((Get-Date) -ge $deadline) { throw "interactive guest text task timed out after $timeoutSeconds seconds" }',
        '    Start-Sleep -Milliseconds $pollMilliseconds',
        '  }',
        '} finally {',
        '  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue',
        '}',
    ].join('\n');
}

export async function sendGuestTextFile(argv = process.argv.slice(2)) {
    const { filePath } = parseSendGuestTextFileArguments(argv);
    const { diagnostics, guestScriptStagingDirectory, paths } = config;
    const files = await Promise.all([
        stageFile(path.join(paths.guestScriptsDir, 'send-unicode-text.ps1'), 'send-unicode-text.ps1'),
        stageFile(filePath, 'input.txt'),
    ]);
    const result = await withGuestSession((session) => withGuestStaging(session, {
        stagingRoot: guestScriptStagingDirectory,
        files,
    }, async (remoteDirectory) => {
        const scriptPath = path.win32.join(remoteDirectory, 'send-unicode-text.ps1');
        const inputPath = path.win32.join(remoteDirectory, 'input.txt');
        const output = await executeGuestPowerShell(
            session.ssh,
            buildInteractiveScriptRunner(
                scriptPath,
                inputPath,
                `AutoSetupSendText-${randomUUID()}`,
                diagnostics.guestTextInput,
            ),
            'send Unicode text to focused guest window',
        );
        return JSON.parse(output);
    }));
    console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sendGuestTextFile().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
