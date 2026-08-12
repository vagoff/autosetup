function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Генерализованный примитив: повторяет действие (onEachAttempt), пока
// наблюдаемое состояние VM (captureState) не перестанет считаться
// "прежним" по мнению isUnchanged(current, baseline). Что значит
// "состояние" и что считать значимым изменением — решает вызывающий
// модуль (например: точное равенство хэша кадра, или порог прироста
// счётчика прочитанных байт, отсекающий фоновый шум устройства от
// реального прогресса) — этот примитив ничего не знает про
// QMP/экран/диск и не подставляет свой критерий сравнения (SRP).
// Критерий остановки — наблюдаемое состояние, а не время.
//
// Все параметры обязательные явные аргументы — единственный источник их
// значений: data/config.json5 (CONFIG-SINGLE-SOURCE), никаких default
// значений в этой сигнатуре быть не должно.
export async function waitForObservableChange({ captureState, isUnchanged, onEachAttempt, pollIntervalMs, maxAttempts, timeoutHint }) {
  const baseline = await captureState();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await onEachAttempt();
    await sleep(pollIntervalMs);
    const current = await captureState();
    if (!isUnchanged(current, baseline)) return;
  }

  throw new Error(
    `состояние VM не изменилось за ${maxAttempts} попыток (интервал ${pollIntervalMs}мс): ${timeoutHint}`
  );
}
