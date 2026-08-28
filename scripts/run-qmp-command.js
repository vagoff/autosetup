import { connectQmp } from '../src/infrastructure/connect-qmp.js';
import { config } from '../src/configure.js';

// Разовый CLI поверх src/infrastructure/connect-qmp.js: одна QMP-команда, JSON-ответ
// в stdout. Ничего не знает про смысл конкретных команд (SRP) — замена
// разовым `node -e "..."` в ручной диагностике (query-status, query-block,
// quit, send-key и т.п.), не отдельный режим на каждую команду.
async function runQmpCommand(command, argsJson) {
  if (!command) {
    throw new Error('использование: node scripts/run-qmp-command.js <command> [argsJSON]');
  }
  const args = argsJson ? JSON.parse(argsJson) : undefined;
  const { loopbackHost } = config.network;
  const { qmpPort, qmpConnectTimeoutMs } = config.qemu;

  const qmp = await connectQmp(loopbackHost, qmpPort, qmpConnectTimeoutMs);
  try {
    const result = await qmp.execute(command, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    qmp.disconnect();
  }
}

const [, , command, argsJson] = process.argv;
runQmpCommand(command, argsJson).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
