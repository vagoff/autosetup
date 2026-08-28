// Отправляет гостю одно нажатие клавиши через QMP (qcode-имя клавиши,
// например 'ret', 'spc', 'tab' — список см. в документации QEMU QKeyCode).
export function sendGuestKey(qmp, key) {
    return qmp.execute('send-key', { keys: [{ type: 'qcode', data: key }] });
}
