import net from 'node:net';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../configure.js';

// Ждёт либо истечения задержки, либо сигнала остановки — не задерживает
// выключение на лишние serialLogReconnectDelayMs при shutdown.
function delay(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

// Один цикл подключения: резолвится, когда соединение закрылось (штатно,
// по ошибке или по сигналу остановки) — реконнект решает вызывающий цикл.
function runOneConnection({ host, port, out, signal }) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const abortSocket = () => socket.destroy();
        signal?.addEventListener('abort', abortSocket, { once: true });

        socket.on('data', (chunk) => out.write(chunk));
        // Обязательный обработчик: без него необработанный 'error' (например
        // ECONNREFUSED, пока qemu ещё не поднял listener) роняет процесс —
        // сам факт ошибки нас не интересует, за ним всегда следует 'close'.
        socket.once('error', () => {});
        socket.once('close', () => {
            signal?.removeEventListener('abort', abortSocket);
            resolve();
        });
    });
}

// Держит постоянное TCP-соединение с serialLogTcpPort (COM1 гостя) и
// дописывает все полученные байты в serialLogPath. Единственная задача —
// durable-копия COM1: QEMU socket chardev ничего не буферизует, если
// клиент не подключён в момент записи гостем — без постоянного слушателя
// лог первого логона теряется безвозвратно (см. историю задачи, где
// cache/win11-1c/com1.log оказался протухшим артефактом ещё со старой
// -chardev file схемы). Переподключается неограниченно, пока не придёт
// сигнал остановки — единичный обрыв (например, VM перезагружается) не
// повод останавливаться.
export async function captureSerialLog({ signal } = {}) {
    const { network, qemu } = config;
    mkdirSync(path.dirname(qemu.serialLogPath), { recursive: true });
    const out = createWriteStream(qemu.serialLogPath, { flags: 'a' });
    out.on('error', (error) => {
        throw new Error(`capture-serial-log: не смог писать в ${qemu.serialLogPath}: ${error.message}`);
    });

    while (!signal?.aborted) {
        await runOneConnection({ host: network.loopbackHost, port: qemu.serialLogTcpPort, out, signal });
        if (signal?.aborted) break;
        await delay(qemu.serialLogReconnectDelayMs, signal);
    }

    await new Promise((resolve) => out.end(resolve));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const controller = new AbortController();
    process.on('SIGINT', () => controller.abort());
    process.on('SIGTERM', () => controller.abort());
    captureSerialLog({ signal: controller.signal })
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
