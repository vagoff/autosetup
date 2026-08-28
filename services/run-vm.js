import { spawnSwtpmProcess } from './spawn-swtpm-process.js';
import { spawnQemuProcess } from './spawn-qemu-process.js';
import { confirmCdBootPrompt } from './confirm-cd-boot-prompt.js';
import { buildAnswerFileImage } from './build-answer-file-image.js';
import { captureSerialLog } from './capture-serial-log.js';
import { resolveBootFromInstaller } from './lib/resolve-boot-from-installer.js';
import { spawnOrphanWatchdog } from './lib/spawn-orphan-watchdog.js';
import { restartInstallIfInterrupted } from './restart-install-if-interrupted.js';
import { waitForWindowsInstallComplete } from './wait-for-windows-install-complete.js';
import { markWindowsInstallComplete } from './mark-windows-install-complete.js';
import { config } from './config.js';

// Тонкий оркестратор: поднимает swtpm, дожидается сокета, при установке —
// собирает свежий образ файла ответов и потом детерминированно проходит
// CD-boot prompt, поднимает qemu, включает постоянный capture COM1-лога,
// связывает жизненные циклы всех троих. Никакой бизнес-логики — она вся в
// spawn-swtpm-process.js / spawn-qemu-process.js / confirm-cd-boot-prompt.js /
// build-answer-file-image.js / capture-serial-log.js.
async function runVm() {
    // Если предыдущая попытка установки прервалась на середине — пересобрать
    // VM с нуля раньше, чем что-либо ещё; см. restart-install-if-interrupted.js
    // про то, какой ценой обходится не делать это (интерактивный диалог
    // Windows Setup, который иначе пришлось бы распознавать на экране).
    await restartInstallIfInterrupted();

    // Считается один раз в начале запуска: bootFromInstaller — это факт
    // про диск на момент старта (см. resolve-boot-from-installer.js), не
    // то, что может измениться за время жизни этого процесса.
    const bootFromInstaller = resolveBootFromInstaller();

    if (bootFromInstaller) {
        buildAnswerFileImage();
    }

    const swtpm = await spawnSwtpmProcess();

    const qemu = spawnQemuProcess();

    // Переживает даже SIGKILL этого самого процесса — см. doc/BUGS.md
    // ("SIGKILL по run-vm-cli.js оставляет qemu и swtpm сиротами") и
    // комментарий в spawn-orphan-watchdog.js про то, почему обычные
    // обработчики сигналов этот случай в принципе не могут покрыть.
    spawnOrphanWatchdog({
        parentPid: process.pid,
        watchedPids: [qemu.pid, swtpm.pid],
        pollIntervalMs: config.qemu.orphanWatchdogPollIntervalMs,
    });

    // Чистый Node-код (не внешний бинарь), поэтому живёт в этом же
    // процессе, а не отдельным spawn-*-process.js — без лишнего процесса
    // ради процесса (ANTI-BLOAT).
    const serialLogCapture = new AbortController();
    captureSerialLog({ signal: serialLogCapture.signal }).catch((error) => {
        console.error(`capture-serial-log: ${error.message}`);
    });

    // После подтверждённого конца FirstLogonCommands переводим durable
    // сигнал COM1 в persistent marker автоматически. Раньше это требовало
    // отдельного ручного запуска mark-windows-install-complete.js; при
    // перезапуске VM до него restart-install-if-interrupted.js ошибочно
    // считал полностью готовый диск прерванной установкой и пересоздавал
    // его. wait-for-windows-install-complete.js ожидает файловое событие,
    // не «примерное время установки Windows».
    if (bootFromInstaller) {
        waitForWindowsInstallComplete()
            .then(() => {
                markWindowsInstallComplete();
                console.log(`отмечена успешная установка Windows: ${config.paths.installCompleteMarkerPath}`);
            })
            .catch((error) => console.error(`mark-windows-install-complete: ${error.message}`));
    }

    const shutdown = (signal) => {
        qemu.kill(signal);
        swtpm.kill(signal);
        serialLogCapture.abort();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    qemu.on('exit', (code, signal) => {
        swtpm.kill('SIGTERM');
        serialLogCapture.abort();
        process.exit(signal ? 1 : (code ?? 0));
    });

    // Прохождение CD-boot prompt имеет смысл только при загрузке с
    // установочного носителя — на загрузке с диска (bootFromInstaller=false)
    // этого экрана не существует, слать в него клавиши нельзя.
    if (bootFromInstaller) {
        await confirmCdBootPrompt();
    }
}

runVm().catch((error) => { // [!] unwrapped main [!]
    console.error(error.message);
    process.exit(1);
});
