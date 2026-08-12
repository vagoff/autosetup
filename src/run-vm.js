import { spawnSwtpmProcess } from './spawn-swtpm-process.js';
import { spawnQemuProcess } from './spawn-qemu-process.js';

// Тонкий оркестратор: поднимает swtpm, дожидается сокета, поднимает qemu,
// связывает жизненные циклы обоих процессов. Никакой бизнес-логики —
// она вся в spawn-swtpm-process.js / spawn-qemu-process.js.
async function runVm() {
  const swtpm = await spawnSwtpmProcess();

  const qemu = spawnQemuProcess();

  const shutdown = (signal) => {
    qemu.kill(signal);
    swtpm.kill(signal);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  qemu.on('exit', (code, signal) => {
    swtpm.kill('SIGTERM');
    process.exit(signal ? 1 : (code ?? 0));
  });
}

runVm().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
