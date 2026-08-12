import { config } from './config.js';
import { runWinrmPowershell } from './lib/run-winrm-powershell.js';

// Проверяет не просто TCP-port, а запуск безопасной read-only команды
// PowerShell через Negotiate/NTLM под локальной администраторской учёткой.
export async function checkWinrmAccess() {
  const output = await runWinrmPowershell({
    script: '$PSVersionTable.PSVersion.ToString()',
    ...config,
  });
  const version = output.trim();
  if (!version) throw new Error('WinRM PowerShell returned an empty version');
  console.log(`WinRM PowerShell: OK (PowerShell ${version})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkWinrmAccess().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
