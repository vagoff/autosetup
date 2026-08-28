import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../../..');
const env = { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5' };

// Настоящий CredSSP-логин через vendor/impacket (src/tools/check-rdp-login.js),
// не просто открытый TCP-порт — требует cache/.venv (scripts/pyinit.sh) и
// уже накатанную фичу rdp на госте (src/verbs/check-rdp-access.js это же
// подтверждает на уровне реестра/firewall).
//
// Позитивный тест идёт через CLI целиком (execFile, без аргументов) — так
// его реально вызывает человек/агент. Негативные — через attemptRdpLogin()
// напрямую с явно неверными параметрами: у CLI-фасада (checkRdpLogin())
// нет флагов для "неверный хост"/"неверный пароль", и заводить их только
// ради теста незачем — see src/tools/check-rdp-login.js про то, почему
// attemptRdpLogin() вынесен отдельно от config.
test('live RDP accepts the configured admin credentials via CredSSP', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 30_000,
}, async () => {
    const { stdout } = await execFileAsync(process.execPath, ['src/tools/check-rdp-login.js'], {
        cwd: projectRoot,
        env,
    });
    assert.match(stdout, /^RDP: OK \(login .+ принят\)/mu);
});

test('live RDP login fails fast against an address nothing listens on', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 15_000,
}, async () => {
    const { config } = await import('../../configure.js');
    const { attemptRdpLogin, resolvePythonBinary, resolveRdpCheckScript } = await import('../../tools/check-rdp-login.js');
    await assert.rejects(
        attemptRdpLogin({
            pythonBinary: resolvePythonBinary(),
            scriptPath: resolveRdpCheckScript(),
            // тот же loopback, но hostfwd на rdp привязан только к
            // 127.0.0.1 (data/vars.json5) — на 127.0.0.2:3389 гарантированно
            // никто не слушает.
            hostAddress: '127.0.0.2',
            username: config.unattend.adminUsername,
            password: config.unattend.adminPassword,
            timeoutMs: 5_000,
        }),
        /не удалось выполнить логин/u,
    );
});

test('live RDP login is rejected with the wrong password against the real host', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 15_000,
}, async () => {
    const { config } = await import('../../configure.js');
    const { attemptRdpLogin, resolvePythonBinary, resolveRdpCheckScript } = await import('../../tools/check-rdp-login.js');
    await assert.rejects(
        attemptRdpLogin({
            pythonBinary: resolvePythonBinary(),
            scriptPath: resolveRdpCheckScript(),
            hostAddress: config.rdp.hostAddress,
            username: config.unattend.adminUsername,
            password: `not-${config.unattend.adminPassword}`,
            timeoutMs: config.rdp.check.timeoutSeconds * 1000,
        }),
        /credentials отклонены сервером/u,
    );
});
