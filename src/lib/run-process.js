import { spawn } from 'node:child_process';

// Запускает процесс до завершения (не в фоне), пробрасывает stdio,
// отклоняет промис при ненулевом коде выхода. Используется скриптами,
// которым нужно один раз вызвать внешнюю утилиту и дождаться результата
// (в отличие от spawn-*-process.js, которые запускают долгоживущие
// процессы вроде qemu/swtpm).
export function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) return reject(new Error(`${command}: убит сигналом ${signal}`));
      if (code !== 0) return reject(new Error(`${command}: код выхода ${code}`));
      resolve();
    });
  });
}
