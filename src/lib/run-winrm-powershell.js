import { runPowershell } from 'winrm-client';

// Выполняет один PowerShell script text по существующему WinRM listener.
// Имя local-account намеренно квалифицируется NetBIOS-именем гостя:
// winrm-client выбирает NTLM для формата COMPUTER\\user, тогда как для
// голого user он попытался бы применить отключённый Basic.
export async function runWinrmPowershell({ script, network, unattend, winRm }) {
  if (winRm.authScheme !== 'ntlm') {
    throw new Error(`неподдерживаемый winRm.authScheme: ${winRm.authScheme}`);
  }
  const username = `${unattend.computerName}\\${unattend.adminUsername}`;
  return runPowershell(
    script,
    network.loopbackHost,
    username,
    unattend.adminPassword,
    winRm.hostPort,
    winRm.useHttps,
    winRm.rejectUnauthorized
  );
}
