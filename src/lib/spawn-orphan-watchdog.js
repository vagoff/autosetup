import { spawn } from 'node:child_process';

// Переживает даже SIGKILL родителя: process-manager (или что угодно ещё)
// может убить процесс run-vm.js без единого шанса выполнить хоть строчку
// его собственного кода — SIGTERM/SIGINT-обработчики и qemu.on('exit') в
// run-vm.js при SIGKILL не срабатывают вообще. Осиротевшие qemu и swtpm
// держат QMP-порт/файлы TPM-состояния дальше, и следующий старт той же
// VM не может занять порт и падает (был закрыт как дефект — см. git log
// doc/BUGS.md).
//
// Решение — отдельный detached-процесс, не разделяющий судьбу родителя:
// он порождён (spawn + detached:true + unref) один раз при старте VM и
// переживает смерть run-vm.js по построению, каким бы способом тот ни
// умер. Как только видит, что родителя больше нет — сам добивает
// переданные pid'ы и завершается.
//
// Опрос через process.kill(pid, 0), а не файл/сокет-проба: корректно
// ровно потому, что вотчдог порождён на том же хосте, что и сам
// qemu/swtpm — run-vm.js всегда исполняется на хосте, не в sandboxed-
// контейнере агента (там эта же проверка была бы лживой, см. памятку про
// PID-namespace в scripts/shutdown.sh).
export function spawnOrphanWatchdog({ parentPid, watchedPids, pollIntervalMs }) {
    // Отдельный процесс не может забрать функции по замыканию — только
    // сериализуемые данные, поэтому watchdog-код передаётся как текст
    // через -e, а не импортом (у него и не может быть общего module graph
    // с умирающим родителем).
    // ВАЖНО: таймеры внутри этого скрипта — НЕ .unref(). Это единственный
    // код в собственном event loop'е этого процесса: unref'нутый таймер
    // ничем не держал бы этот loop открытым, и процесс завершился бы сразу
    // после первого тика синхронного кода, ни разу не опросив родителя
    // (воспроизведено вживую при тестировании — process.exit наступал до
    // первого срабатывания setInterval). unref() ниже, на самом
    // watchdog-объекте в spawn(), — другое: он про то, чтобы РОДИТЕЛЬ (тот,
    // кто вызвал spawnOrphanWatchdog) не ждал именно этот процесс при
    // своём завершении, и он как раз обязателен.
    const watchdogScript = `
        const parentPid = ${JSON.stringify(parentPid)};
        const watchedPids = ${JSON.stringify(watchedPids)};
        const pollIntervalMs = ${JSON.stringify(pollIntervalMs)};
        function isAlive(pid) {
            try { process.kill(pid, 0); return true; } catch { return false; }
        }
        const timer = setInterval(() => {
            if (isAlive(parentPid)) return;
            clearInterval(timer);
            for (const pid of watchedPids) {
                try { process.kill(pid, 'SIGTERM'); } catch {}
            }
            setTimeout(() => {
                for (const pid of watchedPids) {
                    try { process.kill(pid, 'SIGKILL'); } catch {}
                }
                process.exit(0);
            }, 10000);
        }, pollIntervalMs);
    `;
    const watchdog = spawn(process.execPath, ['-e', watchdogScript], {
        detached: true,
        stdio: 'ignore',
    });
    watchdog.unref();
    return watchdog;
}
