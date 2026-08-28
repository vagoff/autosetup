import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { config } from '../configure.js';

function logContainsCompletionLine(serialLogPath, completionLine) {
    return existsSync(serialLogPath) && readFileSync(serialLogPath, 'utf8').includes(completionLine);
}

// Ждёт наблюдаемое появление финальной строки в durable COM1-логе. Это не
// таймер загрузки Windows: watcher реагирует на изменение файла и завершает
// ожидание только на самом сигнале completionLine.
export function waitForWindowsInstallComplete() {
    const { serialLogPath } = config.qemu;
    const { firstLogonCompletionLogLine } = config.unattend;
    const logDirectory = path.dirname(serialLogPath);
    const logFilename = path.basename(serialLogPath);

    return new Promise((resolve, reject) => {
        let completed = false;
        let watcher;
        const finish = (error) => {
            if (completed) return;
            completed = true;
            watcher?.close();
            if (error) reject(error);
            else resolve();
        };
        const check = () => {
            try {
                if (logContainsCompletionLine(serialLogPath, firstLogonCompletionLogLine)) finish();
            } catch (error) {
                finish(new Error(`read ${serialLogPath} while waiting for Windows install completion: ${error.message}`));
            }
        };

        try {
            watcher = watch(logDirectory, (_eventType, filename) => {
                if (filename === logFilename) check();
            });
            watcher.once('error', (error) => finish(new Error(`watch ${logDirectory}: ${error.message}`)));
            check();
        } catch (error) {
            finish(new Error(`watch ${logDirectory}: ${error.message}`));
        }
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    waitForWindowsInstallComplete()
        .then(() => console.log('Windows install completion: observed'))
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
