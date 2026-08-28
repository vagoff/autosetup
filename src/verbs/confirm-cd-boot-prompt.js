import { connectQmp } from '../infrastructure/connect-qmp.js';
import { sendGuestKey } from '../infrastructure/send-guest-key.js';
import { queryCdromBytesRead } from '../infrastructure/query-cdrom-bytes-read.js';
import { waitForStableState } from '../infrastructure/wait-for-stable-state.js';
import { waitForObservableChange } from '../infrastructure/wait-for-observable-change.js';
import { config } from '../configure.js';

// UEFI CD-загрузчик показывает "Press any key to boot from CD or DVD" с
// собственным внутренним таймаутом; без нажатия клавиши он молча
// пропускает CD и падает на следующее устройство (диск/PXE). Жмём
// bootPromptConfirmation.key всё время, но решение принимаем по форме
// поведения rd_bytes (query-blockstats), а не по порогу объёма или
// времени (см. обоснование в data/base.json5). Три шага, "рост →
// плато → рост":
//   1. дождаться ПЕРВОГО роста — прошивка безусловно вычитывает сам
//      El Torito загрузчик ещё до показа prompt'а, это происходит и при
//      успехе, и при отказе одинаково, но пока ничего не читалось —
//      "стабильно" было бы тривиально верно и ни о чём не говорило бы;
//   2. дождаться, пока этот всплеск чтения затихнет (плато) — с этой
//      честной точки можно отличить реальный сигнал от шума;
//   3. дождаться ВТОРОГО, повторного роста — только он означает, что
//      prompt принял клавишу и начался настоящий стриминг Windows.
export async function confirmCdBootPrompt() {
    const { loopbackHost } = config.network;
    const { qmpPort, qmpConnectTimeoutMs, cdromDeviceId, bootPromptConfirmation } = config.qemu;
    const { key, pollIntervalMs, requiredStableSamples, maxAttempts } = bootPromptConfirmation;

    const qmp = await connectQmp(loopbackHost, qmpPort, qmpConnectTimeoutMs);
    try {
        const captureState = () => queryCdromBytesRead(qmp, cdromDeviceId);
        const onEachAttempt = () => sendGuestKey(qmp, key);
        const isUnchanged = (current, baseline) => current === baseline;

        await waitForObservableChange({
            captureState,
            isUnchanged,
            onEachAttempt,
            pollIntervalMs,
            maxAttempts,
            timeoutHint: `CD-привод "${cdromDeviceId}" не читался вообще ни разу — прошивка не дошла до загрузочного меню`,
        });

        await waitForStableState({
            captureState,
            onEachAttempt,
            pollIntervalMs,
            requiredStableSamples,
            maxAttempts,
            timeoutHint: `чтение с CD-привода "${cdromDeviceId}" после первого всплеска не улеглось`,
        });

        await waitForObservableChange({
            captureState,
            isUnchanged,
            onEachAttempt,
            pollIntervalMs,
            maxAttempts,
            timeoutHint: `CD-привод "${cdromDeviceId}" так и не начал читаться повторно — прошивка не приняла нажатие клавиши`,
        });
    } finally {
        qmp.disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    confirmCdBootPrompt().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
