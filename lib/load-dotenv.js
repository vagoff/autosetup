import { existsSync, readFileSync } from 'node:fs';

// Минимальный dotenv именно для конфигурации запуска. Не перезаписывает
// process.env: CI/человек всегда может явно выбрать другой профиль.
export function loadDotenv(pathname, environment = process.env) {
    if (!existsSync(pathname)) return;
    for (const sourceLine of readFileSync(pathname, 'utf8').split(/\r?\n/u)) {
        const line = sourceLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) throw new Error(`${pathname}: invalid environment line`);
        const name = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`${pathname}: invalid environment variable ${name}`);
        if (environment[name] === undefined) environment[name] = value;
    }
}
