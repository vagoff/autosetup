// powershell.exe -EncodedCommand ожидает base64 от UTF-16LE — так
// произвольно сложный PS-скрипт (кавычки, переносы строк, $-переменные)
// попадает в один CommandLine XML-элемента FirstLogonCommands без единого
// экранирования вручную.
export function encodePowerShellCommand(scriptText) {
    const base64 = Buffer.from(scriptText, 'utf16le').toString('base64');
    return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64}`;
}
