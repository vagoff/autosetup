import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../configure.js';

// Настоящая протокольная проверка RDP (TLS + CredSSP handshake с реальным
// логином), в отличие от src/verbs/check-rdp-access.js — тот только читает
// реестр/firewall гостя по SSH и подтверждает, что enable-rdp-access.ps1
// отработал, но никогда не проверяет сам протокол на 3389. Здесь же —
// vendor/impacket/examples/rdp_check.py как есть (OWNTHESOURCE: файл не
// правится, используется как внешняя зависимость, как и был бы pip-пакет
// impacket).
//
// forbiddenCredentialChars: impacket сам парсит строку вида
// "domain/user:pass@host" регэкспом (target_regex в impacket/examples/
// utils.py) — символы '/', ':', '@' в пароле или логине эту строку
// разъедут, и мы молча проверим не те credentials. Лучше упасть явно.
const forbiddenCredentialChars = /[/:@]/u;

function assertUsableCredential(label, value) {
    if (forbiddenCredentialChars.test(value)) {
        throw new Error(`RDP check: ${label} содержит один из символов "/", ":", "@" — impacket.parse_target() не сможет корректно разобрать target-строку`);
    }
}

function runRdpCheck(pythonBinary, scriptPath, target, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(pythonBinary, [scriptPath, target], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
        }, timeoutMs);
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, output });
        });
    });
}

export function resolvePythonBinary() {
    return path.join(config.paths.cacheDir, '.venv', 'bin', 'python3');
}

export function resolveRdpCheckScript() {
    return path.join(config.paths.vendorDir, 'impacket', 'examples', 'rdp_check.py');
}

// Ядро проверки — без обращения к config, чтобы тесты (в т.ч. негативные:
// заведомо не тот адрес, заведомо неверный пароль) могли передать
// параметры напрямую, не подменяя ни .env.secrets, ни живой пароль гостя.
// checkRdpLogin() ниже — единственный потребитель, который берёт эти же
// параметры из config, это и есть CLI-фасад.
export async function attemptRdpLogin({ pythonBinary, scriptPath, hostAddress, username, password, timeoutMs }) {
    if (!existsSync(pythonBinary)) {
        throw new Error(`нет venv для rdp_check.py: ${pythonBinary}. Сначала запусти scripts/pyinit.sh`);
    }
    if (!existsSync(scriptPath)) {
        throw new Error(`нет ${scriptPath} — vendor/impacket не склонирован`);
    }
    assertUsableCredential('username', username);
    assertUsableCredential('password', password);

    // domain пустой: локальная (не доменная) учётка.
    const target = `/${username}:${password}@${hostAddress}`;
    const { code, signal, output } = await runRdpCheck(pythonBinary, scriptPath, target, timeoutMs);

    if (signal === 'SIGKILL') {
        throw new Error(`RDP check: таймаут ${timeoutMs}ms без ответа (${hostAddress}). Вывод:\n${output}`);
    }
    if (output.includes('Access Granted')) return;
    if (output.includes('Access Denied')) {
        throw new Error(`RDP: credentials отклонены сервером (${username}@${hostAddress}). Вывод:\n${output}`);
    }
    throw new Error(`RDP check: не удалось выполнить логин на ${hostAddress} (код выхода ${code}). Вывод:\n${output}`);
}

export async function checkRdpLogin() {
    const { rdp, unattend } = config;
    if (!rdp) throw new Error('в активном профиле нет фичи rdp — проверять нечего (см. data/profiles/*.json5)');

    // vendor/impacket/examples/rdp_check.py хардкодит порт гостя 3389
    // внутри себя (get_connected_socket(host, 3389, ...)) — это факт
    // протокола RDP, а не наш выбор, и форкать чужой файл ради
    // параметризации несуществующей проблемы (см. OWNTHESOURCE) незачем.
    // Если это когда-нибудь перестанет совпадать с data/vars.json5 —
    // лучше упасть тут явно, чем молча стучаться не в тот порт.
    if (rdp.hostPort !== 3389) {
        throw new Error(`RDP check: rdp.hostPort=${rdp.hostPort}, а vendor/impacket/examples/rdp_check.py умеет проверять только порт 3389 (см. комментарий в src/tools/check-rdp-login.js)`);
    }

    await attemptRdpLogin({
        pythonBinary: resolvePythonBinary(),
        scriptPath: resolveRdpCheckScript(),
        hostAddress: rdp.hostAddress,
        username: unattend.adminUsername,
        password: unattend.adminPassword,
        timeoutMs: rdp.check.timeoutSeconds * 1000,
    });
    console.log(`RDP: OK (login ${unattend.adminUsername}@${rdp.hostAddress}:${rdp.hostPort} принят)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkRdpLogin().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
