function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Обобщённый примитив, зеркальный к wait-for-observable-change.js:
// повторяет действие (onEachAttempt), пока наблюдаемое состояние не
// ПЕРЕСТАНЕТ меняться — то есть пока captureState() не вернёт одно и то
// же значение requiredStableSamples раз подряд. Возвращает
// стабилизировавшееся значение — готовую точку отсчёта для последующего
// waitForObservableChange(). Как и он, ничего не знает про
// QMP/экран/диск (SRP).
export async function waitForStableState({ captureState, onEachAttempt, pollIntervalMs, requiredStableSamples, maxAttempts, timeoutHint }) {
    let previous = await captureState();
    let streak = 1;

    for (let attempt = 1; streak < requiredStableSamples && attempt <= maxAttempts; attempt++) {
        await onEachAttempt();
        await sleep(pollIntervalMs);
        const current = await captureState();
        streak = current === previous ? streak + 1 : 1;
        previous = current;
    }

    if (streak < requiredStableSamples) {
        throw new Error(
            `состояние VM не стабилизировалось за ${maxAttempts} попыток (интервал ${pollIntervalMs}мс): ${timeoutHint}`
        );
    }
    return previous;
}
