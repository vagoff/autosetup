function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Ожидает не время запуска HTTP-службы, а успешный HTTP-ответ. deadline
// ограничивает только реальную поломку (занятый порт, неверный config и т.п.).
export async function waitForHttp({ url, timeoutMs, pollIntervalMs }) {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'no response';
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(pollIntervalMs) });
            if (response.ok) return;
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error.message;
        }
        await wait(pollIntervalMs);
    }
    throw new Error(`HTTP endpoint did not become ready within ${timeoutMs}ms: ${url}: ${lastError}`);
}
