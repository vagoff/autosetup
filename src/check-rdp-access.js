import { NodeSSH } from 'node-ssh';
import { config } from './config.js';
import { probeTcpPort } from './lib/probe-tcp-port.js';

// Функциональная проверка: не просто "открыт ли TCP-порт 3389" (это
// могло бы быть случайностью/посторонним сервисом), а действительно ли
// RDP включён штатным способом — fDenyTSConnections=0 И хотя бы одно
// firewall-правило группы "Remote Desktop" включено. Проверяется через
// уже рабочий SSH-канал (тот же приём, что update-serial-command-
// agent.js — EncodedCommand, без ручного quoting).
//
// Настоящий RDP-логин (клиентское подключение) сюда сознательно не
// входит — в проекте нет RDP-клиентской библиотеки, и финальная
// приёмка "человек зашёл RDP-клиентом и увидел рабочий стол" делается
// вручную. Эта проверка только подтверждает, что автоматика
// (enable-rdp-access.ps1) реально отработала.
export async function checkRdpAccess() {
    const { rdp, openSsh, network, unattend } = config;
    if (!rdp) throw new Error('в активном профиле нет фичи rdp — проверять нечего (см. data/profiles/*.json5)');

    const portOpen = await probeTcpPort(network.loopbackHost, rdp.hostPort, 5000);
    if (!portOpen) {
        throw new Error(`RDP: порт ${network.loopbackHost}:${rdp.hostPort} не отвечает`);
    }

    const ssh = new NodeSSH();
    try {
        await ssh.connect({
            host: network.loopbackHost,
            port: openSsh.hostPort,
            username: unattend.adminUsername,
            privateKeyPath: openSsh.clientPrivateKeyPath,
            readyTimeout: openSsh.check.connectTimeoutSeconds * 1000,
            tryKeyboard: false,
        });

        const checkScript = [
            "$deny = (Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction Stop).fDenyTSConnections",
            "$enabledRuleCount = (Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' }).Count",
            'Write-Output "fDenyTSConnections=$deny enabledFirewallRules=$enabledRuleCount"',
        ].join('; ');
        const encoded = Buffer.from(checkScript, 'utf16le').toString('base64');
        const result = await ssh.execCommand(`powershell.exe -NoProfile -EncodedCommand ${encoded}`);
        if (result.code !== 0) {
            throw new Error(`RDP check script exited with code ${result.code}: ${result.stderr || result.stdout}`);
        }

        const match = result.stdout.match(/fDenyTSConnections=(\d+) enabledFirewallRules=(\d+)/);
        if (!match) {
            throw new Error(`RDP check: не смог распарсить вывод гостя: ${result.stdout.trim()}`);
        }
        const [, fDenyTSConnections, enabledFirewallRules] = match;
        if (fDenyTSConnections !== '0') {
            throw new Error(`RDP: fDenyTSConnections=${fDenyTSConnections}, ожидался 0 (RDP выключен)`);
        }
        if (Number(enabledFirewallRules) < 1) {
            throw new Error('RDP: ни одно firewall-правило группы "Remote Desktop" не включено');
        }
        console.log(`RDP: OK (порт ${rdp.hostPort} открыт, fDenyTSConnections=0, enabled firewall rules=${enabledFirewallRules})`);
    } finally {
        ssh.dispose();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    checkRdpAccess().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
