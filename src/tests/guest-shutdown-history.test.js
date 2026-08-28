import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTOSETUP_PROFILE = 'data/profiles/win11-1c.json5';
const { buildGuestShutdownHistory, buildGuestShutdownHistoryScript } = await import('../tools/read-guest-shutdown-history.js');

function event(recordId, timeCreated, provider, id, data = []) {
    return { recordId: String(recordId), timeCreated, provider, id, data };
}

const KERNEL_GENERAL = 'Microsoft-Windows-Kernel-General';
const KERNEL_POWER = 'Microsoft-Windows-Kernel-Power';

test('guest shutdown history correlates clean and unclean shutdowns with the next boot', () => {
    const history = buildGuestShutdownHistory([
        event(1, '2026-08-20T09:00:00.000Z', KERNEL_GENERAL, 12),
        event(2, '2026-08-20T10:00:00.000Z', 'USER32', 1074, [{ name: 'process', value: 'winlogon.exe' }]),
        event(3, '2026-08-20T10:00:02.000Z', KERNEL_GENERAL, 13),
        event(4, '2026-08-20T10:00:30.000Z', 'EventLog', 6006),
        event(5, '2026-08-20T10:01:00.000Z', KERNEL_GENERAL, 12),
        event(6, '2026-08-20T11:00:00.000Z', 'USER32', 1074),
        event(7, '2026-08-20T11:00:02.000Z', KERNEL_GENERAL, 13),
        event(8, '2026-08-20T11:03:00.000Z', KERNEL_GENERAL, 12),
        event(9, '2026-08-20T11:03:01.000Z', KERNEL_POWER, 41),
        event(10, '2026-08-20T11:03:05.000Z', 'EventLog', 6008),
        event(11, '2026-08-20T12:00:00.000Z', KERNEL_GENERAL, 12),
        event(12, '2026-08-20T12:00:01.000Z', KERNEL_POWER, 41),
    ], { limit: 10 });

    assert.deepEqual(history.shutdowns.map((shutdown) => shutdown.status), [
        'unclean-without-shutdown-record',
        'shutdown-request-recorded-unclean',
        'shutdown-request-recorded-clean',
    ]);
    assert.equal(history.shutdowns[2].requestToEventLogStopSeconds, 30);
    assert.equal(history.shutdowns[2].eventLogStoppedAt, '2026-08-20T10:00:30.000Z');
    assert.equal(history.shutdowns[1].unexpectedRestartEvidence.length, 2);
    assert.equal(history.currentBootAt, '2026-08-20T12:00:00.000Z');
});

test('guest shutdown history distinguishes clean shutdown without request, shutdown start without completion, and incomplete evidence', () => {
    const clean = buildGuestShutdownHistory([
        event(1, '2026-08-20T09:00:00.000Z', KERNEL_GENERAL, 12),
        event(2, '2026-08-20T10:00:00.000Z', 'EventLog', 6006),
        event(3, '2026-08-20T10:01:00.000Z', KERNEL_GENERAL, 12),
    ], { limit: 10 });
    assert.equal(clean.shutdowns[0].status, 'clean-without-shutdown-request');

    const startedThenUnclean = buildGuestShutdownHistory([
        event(1, '2026-08-20T09:00:00.000Z', KERNEL_GENERAL, 12),
        event(2, '2026-08-20T10:00:00.000Z', KERNEL_GENERAL, 13),
        event(3, '2026-08-20T10:01:00.000Z', KERNEL_GENERAL, 12),
        event(4, '2026-08-20T10:01:01.000Z', KERNEL_POWER, 41),
    ], { limit: 10 });
    assert.equal(startedThenUnclean.shutdowns[0].status, 'shutdown-started-unclean');

    const inconclusive = buildGuestShutdownHistory([
        event(1, '2026-08-20T09:00:00.000Z', KERNEL_GENERAL, 12),
        event(2, '2026-08-20T10:00:00.000Z', KERNEL_GENERAL, 12),
    ], { limit: 10, queryLimitReached: true });
    assert.equal(inconclusive.shutdowns[0].status, 'inconclusive');
    assert.equal(inconclusive.shutdowns[0].historyComplete, false);
});

test('guest shutdown history PowerShell reads only the selected System Event Log records', () => {
    const script = buildGuestShutdownHistoryScript(1000);
    assert.match(script, /Get-WinEvent/u);
    assert.match(script, /LogName = "System"/u);
    assert.match(script, /1074/u);
    assert.match(script, /6006/u);
    assert.match(script, /6008/u);
    assert.match(script, /\$node\.InnerText \} \}/u);
    assert.doesNotMatch(script, /Clear-EventLog|Remove-EventLog|Stop-Process|shutdown\.exe/u);
});

test('guest shutdown history accepts the provider capitalization returned by Windows', () => {
    const history = buildGuestShutdownHistory([
        event(1, '2026-08-20T09:00:00.000Z', KERNEL_GENERAL, 12),
        event(2, '2026-08-20T10:00:00.000Z', 'User32', 1074),
        event(3, '2026-08-20T10:00:05.000Z', 'EventLog', 6006),
        event(4, '2026-08-20T10:01:00.000Z', KERNEL_GENERAL, 12),
    ], { limit: 10 });
    assert.equal(history.shutdowns[0].status, 'shutdown-request-recorded-clean');
});
