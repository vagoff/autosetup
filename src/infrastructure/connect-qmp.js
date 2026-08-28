import net from 'node:net';

// Низкоуровневый QMP-клиент: устанавливает tcp-соединение, проходит
// handshake (qmp_capabilities) и отдаёт execute()/disconnect(). Не знает
// ничего о смысле конкретных команд (screendump/send-key и т.п.) — это
// забота вызывающих модулей (SRP).
//
// connectTimeoutMs обязателен явным аргументом (не default-значением в
// сигнатуре) — единственный источник этого числа: data/base.json5.
export function connectQmp(host, port, connectTimeoutMs) {
    return attemptConnectQmp(host, port, connectTimeoutMs, Date.now() + connectTimeoutMs);
}

// totalTimeoutMs — исходное, неизменное на все ретраи значение, только
// для текста финальной ошибки; deadline — единственный источник решения
// "ретраить ещё или сдаться". Раньше это был один и тот же параметр
// connectTimeoutMs, который на каждый ретрай пересчитывался как остаток
// (deadline - Date.now()) — к моменту финального отказа он мог быть уже
// околонулевым или даже отрицательным (гонка между setTimeout(..., 100)
// и Date.now() >= deadline), и сообщение об ошибке показывало не тот
// таймаут, который реально был запрошен.
function attemptConnectQmp(host, port, totalTimeoutMs, deadline) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        let greeted = false;
        const pending = [];

        const send = (command) => new Promise((res, rej) => {
            pending.push({ resolve: res, reject: rej });
            socket.write(JSON.stringify(command) + '\n');
        });

        const socket = net.connect({ host, port });

        const retryOrFail = (error) => {
            socket.destroy();
            if (Date.now() >= deadline) {
                reject(new Error(`QMP ${host}:${port}: не поднялся за ${totalTimeoutMs}мс: ${error.message}`));
                return;
            }
            setTimeout(() => attemptConnectQmp(host, port, totalTimeoutMs, deadline).then(resolve, reject), 100);
        };

        socket.once('error', retryOrFail);

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if (!line) continue;
                const message = JSON.parse(line);

                if (!greeted && message.QMP) {
                    greeted = true;
                    socket.off('error', retryOrFail);
                    socket.on('error', (error) => {
                        const failure = new Error(`QMP ${host}:${port}: соединение оборвалось: ${error.message}`);
                        pending.splice(0).forEach((waiter) => waiter.reject(failure));
                    });
                    const execute = (command, args) => send({ execute: command, arguments: args });
                    send({ execute: 'qmp_capabilities' }).then(
                        () => resolve({ execute, disconnect: () => socket.end() }),
                        reject
                    );
                    continue;
                }

                if (message.return !== undefined || message.error !== undefined) {
                    const waiter = pending.shift();
                    if (!waiter) continue;
                    if (message.error) waiter.reject(new Error(`QMP-команда отклонена: ${message.error.desc}`));
                    else waiter.resolve(message.return);
                    continue;
                }
                // message.event (device removal, resume и т.п.) сознательно
                // игнорируется — этому клиенту нужен только request/response.
            }
        });
    });
}
