// Явная, поимённая по id фичи таблица "деривированный конфиг фичи ->
// {{TOKEN}} значения для её guest-скриптов" (потребитель —
// build-first-logon-commands.js). Добавление новой опциональной фичи —
// это добавить сюда одну запись; ничего в build-first-logon-commands.js
// трогать не нужно (SRP: одно место знает про содержимое токенов
// конкретной фичи).
export const GUEST_FEATURE_TOKEN_BUILDERS = {
    winrm: (winRm) => ({
        WINRM_LOCAL_ACCOUNT_TOKEN_FILTER_POLICY_VALUE: winRm.localAccountTokenFilterPolicyValue,
    }),
    openssh: (openSsh) => ({
        NETWORK_PROBE_TARGETS_PS_ARRAY: openSsh.networkProbeTargets
            .map((t) => `  [pscustomobject]@{ Host = '${t.host}'; Port = ${t.port}; Label = '${t.label}' }`)
            .join(',\n'),
        NETWORK_PROBE_TIMEOUT_SECONDS: openSsh.networkProbeTimeoutSeconds,
        CAPABILITY_PROBE_TIMEOUT_SECONDS: openSsh.capabilityProbeTimeoutSeconds,
        OPENSSH_ARCHIVE_FILENAME: openSsh.archiveFilename,
        OPENSSH_INSTALLATION_DIRECTORY_NAME: openSsh.installationDirectoryName,
        OPENSSH_SERVICE_NAME: openSsh.serviceName,
        OPENSSH_FIREWALL_RULE_NAME: openSsh.firewallRuleName,
        OPENSSH_FIREWALL_RULE_DISPLAY_NAME: openSsh.firewallRuleDisplayName,
        OPENSSH_PORT: openSsh.port,
        OPENSSH_ADMIN_AUTHORIZED_KEYS_FILENAME: openSsh.adminAuthorizedKeysFilename,
        OPENSSH_CLIENT_PUBLIC_KEY_FILENAME: openSsh.clientPublicKeyFilename,
    }),
    // enable-rdp-access.ps1 не использует ни одного {{TOKEN}} сверх общего
    // prelude (COM_PORT/COM_BAUD_RATE, подставляются отдельно в
    // build-first-logon-commands.js для любой фичи) — своих токенов нет.
    rdp: () => ({}),
    'serial-agent': (serialAgent) => ({
        SERIAL_AGENT_COM_PORT: serialAgent.comPort,
        SERIAL_AGENT_COM_BAUD_RATE: serialAgent.comBaudRate,
        SERIAL_AGENT_SCRIPT_FILENAME: serialAgent.scriptFilename,
        SERIAL_AGENT_INSTALLATION_DIRECTORY_NAME: serialAgent.installationDirectoryName,
        SERIAL_AGENT_LOG_FILENAME: serialAgent.logFilename,
        SERIAL_AGENT_TASK_NAME: serialAgent.taskName,
        SERIAL_AGENT_COMMAND_TIMEOUT_MS: serialAgent.commandTimeoutMs,
        SERIAL_AGENT_MAX_RESPONSE_BYTES: serialAgent.maxResponseBytes,
    }),
};
