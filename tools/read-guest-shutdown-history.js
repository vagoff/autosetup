import { config } from './config.js';
import { executeGuestPowerShell } from './lib/execute-guest-powershell.js';
import { withGuestSession } from './lib/with-guest-session.js';

const EVENT_KINDS = new Map([
    ['microsoft-windows-kernel-general:12', 'boot'],
    ['microsoft-windows-kernel-general:13', 'shutdown-started'],
    ['microsoft-windows-kernel-power:41', 'unexpected-restart'],
    ['user32:1074', 'shutdown-requested'],
    ['eventlog:6006', 'event-log-stopped'],
    ['eventlog:6008', 'unexpected-shutdown-reported'],
]);

function parsePositiveInteger(value, option, maximum) {
    if (!/^\d+$/u.test(value)) throw new Error(`${option} must be an integer between 1 and ${maximum}`);
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`${option} must be an integer between 1 and ${maximum}`);
    return result;
}

function parseArguments(argv, guestShutdownHistory) {
    if (argv.length === 0) return { limit: guestShutdownHistory.defaultShutdownLimit };
    if (argv.length !== 2 || argv[0] !== '--limit') {
        throw new Error('usage: node src/read-guest-shutdown-history.js [--limit N]');
    }
    return { limit: parsePositiveInteger(argv[1], '--limit', guestShutdownHistory.maxShutdownLimit) };
}

function compareRecordIds(left, right) {
    try {
        const order = BigInt(left.recordId) - BigInt(right.recordId);
        return order < 0n ? -1 : (order > 0n ? 1 : 0);
    } catch {
        return left.timeCreated.localeCompare(right.timeCreated);
    }
}

function findLast(events, kind) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].kind === kind) return events[index];
    }
    return null;
}

function serializeEvent(event) {
    if (!event) return null;
    return {
        recordId: event.recordId,
        timeCreated: event.timeCreated,
        provider: event.provider,
        id: event.id,
        data: event.data,
    };
}

function elapsedSeconds(start, end) {
    if (!start || !end) return null;
    const seconds = (Date.parse(end.timeCreated) - Date.parse(start.timeCreated)) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) / 1000 : null;
}

function classifyShutdown({ request, shutdownStarted, eventLogStopped, unexpectedEvidence }) {
    if (eventLogStopped) return request ? 'shutdown-request-recorded-clean' : 'clean-without-shutdown-request';
    if (unexpectedEvidence.length > 0) {
        if (request) return 'shutdown-request-recorded-unclean';
        if (shutdownStarted) return 'shutdown-started-unclean';
        return 'unclean-without-shutdown-record';
    }
    return 'inconclusive';
}

function normalizeEvents(rawEvents) {
    return rawEvents.map((event) => {
        const provider = String(event.provider);
        const id = Number(event.id);
        const kind = EVENT_KINDS.get(`${provider.toLowerCase()}:${id}`);
        if (!kind) throw new Error(`unexpected shutdown-history event: ${provider}/${id}`);
        return {
            recordId: String(event.recordId),
            timeCreated: String(event.timeCreated),
            provider,
            id,
            data: Array.isArray(event.data) ? event.data : [],
            kind,
        };
    }).sort(compareRecordIds);
}

// Строит историю по «границам загрузки»: события 41/6008 записываются уже
// ПОСЛЕ следующей загрузки и поэтому относятся к предшествующему эпизоду.
// Не приписывает QMP/ACPI Windows-эвенту: 1074 доказывает только то, что сама
// Windows зарегистрировала запрос завершения.
export function buildGuestShutdownHistory(rawEvents, { limit, queryLimitReached = false }) {
    const events = normalizeEvents(rawEvents);
    const bootIndexes = events.reduce((result, event, index) => {
        if (event.kind === 'boot') result.push(index);
        return result;
    }, []);
    const shutdowns = [];

    for (let bootNumber = 1; bootNumber < bootIndexes.length; bootNumber += 1) {
        const previousBootIndex = bootIndexes[bootNumber - 1];
        const bootIndex = bootIndexes[bootNumber];
        const nextBootIndex = bootIndexes[bootNumber + 1] ?? events.length;
        const beforeBoot = events.slice(previousBootIndex + 1, bootIndex);
        const afterBoot = events.slice(bootIndex + 1, nextBootIndex);
        const request = findLast(beforeBoot, 'shutdown-requested');
        const shutdownStarted = findLast(beforeBoot, 'shutdown-started');
        const eventLogStopped = findLast(beforeBoot, 'event-log-stopped');
        const unexpectedEvidence = afterBoot.filter((event) => (
            event.kind === 'unexpected-restart' || event.kind === 'unexpected-shutdown-reported'
        ));
        const start = request ?? shutdownStarted;

        shutdowns.push({
            status: classifyShutdown({ request, shutdownStarted, eventLogStopped, unexpectedEvidence }),
            historyComplete: !(queryLimitReached && bootNumber === 1),
            shutdownRequestedAt: request?.timeCreated ?? null,
            shutdownStartedAt: shutdownStarted?.timeCreated ?? null,
            eventLogStoppedAt: eventLogStopped?.timeCreated ?? null,
            requestToEventLogStopSeconds: elapsedSeconds(start, eventLogStopped),
            nextBootAt: events[bootIndex].timeCreated,
            request: serializeEvent(request),
            shutdownStart: serializeEvent(shutdownStarted),
            eventLogStop: serializeEvent(eventLogStopped),
            unexpectedRestartEvidence: unexpectedEvidence.map(serializeEvent),
        });
    }

    return {
        queryLimitReached,
        scannedEventCount: events.length,
        currentBootAt: bootIndexes.length > 0 ? events[bootIndexes.at(-1)].timeCreated : null,
        shutdowns: shutdowns.reverse().slice(0, limit),
    };
}

export function buildGuestShutdownHistoryScript(maxEventRecords) {
    return [
        '$ErrorActionPreference = "Stop"',
        `$maxEventRecords = ${maxEventRecords}`,
        '$eventIds = @(12, 13, 41, 1074, 6006, 6008)',
        '$allowed = @{',
        '  "Microsoft-Windows-Kernel-General" = @(12, 13)',
        '  "Microsoft-Windows-Kernel-Power" = @(41)',
        '  "USER32" = @(1074)',
        '  "EventLog" = @(6006, 6008)',
        '}',
        '$rawEvents = @(Get-WinEvent -FilterHashtable @{ LogName = "System"; Id = $eventIds } -MaxEvents $maxEventRecords -ErrorAction Stop)',
        '$events = @()',
        'foreach ($event in $rawEvents) {',
        '  if (-not $allowed.ContainsKey($event.ProviderName) -or $event.Id -notin $allowed[$event.ProviderName]) { continue }',
        '  [xml]$xml = $event.ToXml()',
        '  $data = @()',
        '  foreach ($node in @($xml.Event.EventData.Data)) {',
        '    if ($null -ne $node) { $data += [ordered]@{ name = [string]$node.Name; value = [string]$node.InnerText } }',
        '  }',
        '  $events += [ordered]@{',
        '    recordId = [string]$event.RecordId',
        '    timeCreated = $event.TimeCreated.ToUniversalTime().ToString("o")',
        '    provider = [string]$event.ProviderName',
        '    id = [int]$event.Id',
        '    data = $data',
        '  }',
        '}',
        '[ordered]@{ queryLimitReached = ($rawEvents.Count -eq $maxEventRecords); events = $events } | ConvertTo-Json -Depth 6 -Compress',
    ].join('\n');
}

export async function readGuestShutdownHistory(argv = process.argv.slice(2)) {
    const guestShutdownHistory = config.diagnostics.guestShutdownHistory;
    const args = parseArguments(argv, guestShutdownHistory);
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildGuestShutdownHistoryScript(guestShutdownHistory.maxEventRecords),
        'read guest shutdown history'
    ));
    const payload = JSON.parse(output);
    const result = buildGuestShutdownHistory(payload.events ?? [], {
        limit: args.limit,
        queryLimitReached: payload.queryLimitReached === true,
    });
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readGuestShutdownHistory().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
