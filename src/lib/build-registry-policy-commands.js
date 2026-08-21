// Одна декларация значения политики реестра -> одна командная строка reg.exe.
// Нужен ровно потому, что одни и те же значения применяются в двух разных
// местах жизненного цикла VM: в specialize-проходе Windows Setup
// (RunSynchronousCommand в autounattend.xml, ещё до первого входа) и в
// guest-скрипте на первом входе. reg.exe выбран как единственный
// исполнитель для обоих: у Windows Setup нет PowerShell в specialize, а
// дублировать таблицу "REG_DWORD -> DWord" ради второго исполнителя
// означало бы два независимых источника правды о типах значений.
export function buildRegistryPolicyArgumentLine({ path, name, type, data }) {
    for (const [field, value] of Object.entries({ path, name, type, data })) {
        if (value === undefined || value === null || value === '') {
            throw new Error(`registry policy value: пустое поле "${field}" (${JSON.stringify({ path, name, type, data })})`);
        }
    }
    if (/["]/u.test(path) || /["]/u.test(name)) {
        throw new Error(`registry policy value: кавычка в path/name не поддерживается: ${path}\\${name}`);
    }
    return `add "${path}" /v "${name}" /t ${type} /d ${data} /f`;
}
