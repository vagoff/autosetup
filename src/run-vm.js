import { spawnSwtpmProcess } from './spawn-swtpm-process.js';
import { spawnQemuProcess } from './spawn-qemu-process.js';
import { confirmCdBootPrompt } from './confirm-cd-boot-prompt.js';
import { buildAnswerFileImage } from './build-answer-file-image.js';
import { config } from './config.js';

// Тонкий оркестратор: поднимает swtpm, дожидается сокета, при установке —
// собирает свежий образ файла ответов и потом детерминированно проходит
// CD-boot prompt, поднимает qemu, связывает жизненные циклы обоих
// процессов. Никакой бизнес-логики — она вся в spawn-swtpm-process.js /
// spawn-qemu-process.js / confirm-cd-boot-prompt.js / build-answer-file-image.js.
async function runVm() {
  if (config.qemu.bootFromInstaller) {
    buildAnswerFileImage();
  }

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

  // Прохождение CD-boot prompt имеет смысл только при загрузке с
  // установочного носителя — на загрузке с диска (bootFromInstaller=false)
  // этого экрана не существует, слать в него клавиши нельзя.
  if (config.qemu.bootFromInstaller) {
    await confirmCdBootPrompt();
  }
}

runVm().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
