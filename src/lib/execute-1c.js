import { quotePowerShell } from './execute-guest-powershell.js';

function quoteWindowsCommandLineArgument(value) {
    const text = String(value);
    if (text.length > 0 && !/[\s"]/u.test(text)) return text;

    let result = '"';
    let slashCount = 0;
    for (const character of text) {
        if (character === '\\') {
            slashCount += 1;
        } else if (character === '"') {
            result += '\\'.repeat(slashCount * 2 + 1);
            result += '"';
            slashCount = 0;
        } else {
            result += '\\'.repeat(slashCount);
            result += character;
            slashCount = 0;
        }
    }
    result += '\\'.repeat(slashCount * 2);
    return `${result}"`;
}

export function buildDesignerArguments(oneCConfiguration, { operationArguments, logPath, authenticate }) {
    const { database } = oneCConfiguration;
    return [
        'DESIGNER',
        '/F', database.directory,
        ...(authenticate ? ['/N', database.userName, '/P', database.password] : []),
        '/DisableStartupMessages',
        '/DisableStartupDialogs',
        '/Out', logPath,
        ...operationArguments,
    ];
}

export function buildInteractiveDesignerArguments(oneCConfiguration) {
    const { database } = oneCConfiguration;
    return [
        'DESIGNER',
        '/F', database.directory,
        '/N', database.userName,
        '/P', database.password,
    ];
}

export function buildEnterpriseArguments(oneCConfiguration, operationArguments) {
    const { database } = oneCConfiguration;
    return [
        'ENTERPRISE',
        '/F', database.directory,
        '/N', database.userName,
        '/P', database.password,
        '/DisableStartupMessages',
        '/DisableStartupDialogs',
        ...operationArguments,
    ];
}

export function buildWindowsArgumentLine(argumentsList) {
    return argumentsList.map(quoteWindowsCommandLineArgument).join(' ');
}

// 1cv8.exe — GUI-процесс: PowerShell call operator не всегда ждёт его и
// оставляет LASTEXITCODE пустым. Start-Process -Wait -PassThru даёт именно
// код завершения Designer; command line собирается по правилам Windows.
// Лог Designer пишет штатный ключ /Out, а не SSH stdout/stderr.
export function buildOneCCommandScript(oneC, { argumentsList, logPath, variablePrefix, label }) {
    return [
        `$${variablePrefix}Executable = ${quotePowerShell(`${oneC.installationDirectory}\\bin\\1cv8.exe`)}`,
        `$${variablePrefix}ArgumentLine = ${quotePowerShell(buildWindowsArgumentLine(argumentsList))}`,
        `$${variablePrefix}LogPath = ${quotePowerShell(logPath)}`,
        `$${variablePrefix}Process = Start-Process -FilePath $${variablePrefix}Executable -ArgumentList $${variablePrefix}ArgumentLine -Wait -PassThru`,
        `$${variablePrefix}ExitCode = [int]$${variablePrefix}Process.ExitCode`,
        `if ($${variablePrefix}ExitCode -ne 0) { throw ${quotePowerShell(`${label}: 1C exited with `)} + $${variablePrefix}ExitCode + ${quotePowerShell(`; see ${logPath}`)} }`,
    ].join('\n');
}
