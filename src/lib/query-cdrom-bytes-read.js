// Читает суммарный объём прочитанных байт с CD-привода через QMP
// query-blockstats. Прямой, недвусмысленный сигнал "прошивка/ОС реально
// читает диск" — в отличие от содержимого экрана не подвержен ложным
// срабатываниям на промежуточные перерисовки текста прошивкой.
export async function queryCdromBytesRead(qmp, deviceId) {
    const stats = await qmp.execute('query-blockstats', undefined);
    const device = stats.find((entry) => entry.device === deviceId);
    if (!device) throw new Error(`query-blockstats: устройство "${deviceId}" не найдено`);
    return device.stats.rd_bytes;
}
