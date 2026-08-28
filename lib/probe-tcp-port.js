import net from 'node:net';

// Проверяет, слушает ли что-то TCP host:port прямо сейчас — не более
// того. true = соединение установилось (и сразу закрывается), false =
// отказано в соединении или не ответили за timeoutMs. Никогда не
// бросает исключений — это ПРОВЕРКА текущего состояния порта, а не
// операция, которая обязана успешно подключиться.
export function probeTcpPort(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        socket.once('connect', () => {
            socket.end();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.setTimeout(timeoutMs, () => {
            socket.destroy();
            resolve(false);
        });
    });
}
