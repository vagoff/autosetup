#!/usr/bin/env bash
# Тонкая обёртка: вся логика — в Node (NOSHELL), эта строка только вызывает
# её. Останавливает запущенную qemu-сессию по qemu.pidFile и детерминированно
# подтверждает смерть процесса (polling, не sleep-гадание) — в отличие от
# QMP "quit", который ничего не подтверждает и который "while true"-обёртка
# вокруг run-vm.js немедленно отменяет новым запуском.
#
# Это ЖЁСТКАЯ остановка (SIGTERM/SIGKILL самому процессу qemu — для
# гостя внутри это как выдернуть вилку из розетки, без штатного
# завершения служб). Основной путь — src/verbs/orchestrators/shutdown-guest.js (ACPI
# system_powerdown, гость сам решает, как штатно выключиться); этот
# скрипт — аварийный резерв на случай, если гость завис и не
# выключается сам, и PID-based (работает только у человека на хосте —
# см. src/verbs/wait-for-qemu-exit.js про то же самое для агента по сети).
set -euo pipefail
exec node --input-type=module - << 'NODE_EOF'
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { config } from './src/configure.js';
import { probeTcpPort } from './src/lib/probe-tcp-port.js';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(pid, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (!isAlive(pid)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, pollIntervalMs);
    };
    check();
  });
}

const { pidFile } = config.qemu;

if (!existsSync(pidFile)) {
  console.log(`нечего останавливать: ${pidFile} не найден`);
  process.exit(0);
}

const pidText = readFileSync(pidFile, 'utf8').trim();
const pid = Number(pidText);
if (!Number.isInteger(pid) || pid <= 0) {
  throw new Error(`${pidFile} содержит не PID: ${JSON.stringify(pidText)}`);
}

if (!isAlive(pid)) {
  console.log(`qemu (pid ${pid}) уже не запущен, чищу протухший ${pidFile}`);
  rmSync(pidFile);
  process.exit(0);
}

// SIGTERM только qemu-процессу — этого достаточно: run-vm.js (родительский
// оркестратор) сам слушает qemu.on('exit', ...) и по нему каскадно гасит
// swtpm и capture-serial-log.js (см. src/services/run-vm.js). Дублировать эту логику
// здесь means MODULE-GRANULARITY/DRY нарушение — она уже есть в одном месте.
console.log(`останавливаю qemu (pid ${pid}) через SIGTERM`);
process.kill(pid, 'SIGTERM');

let exited = await waitForExit(pid, 10000, 200);
if (!exited) {
  console.log(`qemu (pid ${pid}) не завершился за 10с — SIGKILL`);
  process.kill(pid, 'SIGKILL');
  exited = await waitForExit(pid, 5000, 200);
}
if (!exited) {
  throw new Error(`qemu (pid ${pid}) не завершился даже после SIGKILL`);
}
console.log(`qemu (pid ${pid}) остановлен`);
rmSync(pidFile, { force: true });

// Верификация, а не предположение: порты действительно освободились.
const ports = [
  config.qemu.qmpPort,
  config.qemu.serialLogTcpPort,
  config.qemu.serialCommandTcpPort,
  config.winRm.hostPort,
];
const stillListening = (
  await Promise.all(ports.map(async (port) => ((await probeTcpPort(config.network.loopbackHost, port, 1000)) ? port : null)))
).filter((port) => port !== null);

if (stillListening.length > 0) {
  throw new Error(`порты всё ещё слушают после остановки qemu: ${stillListening.join(', ')} (осиротевший процесс?)`);
}
console.log(`все порты (${ports.join(', ')}) освобождены`);
NODE_EOF
