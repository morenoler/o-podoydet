/** Every new viewport load has a deadline; disposal cancels pending fallback. */
export function tileLoadMonitor(onFailure: (message: string) => void, timeoutMs = 12_000, onPartial?: (partial: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let successes = 0;
  let errors = 0;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const fail = (message: string) => {
    if (disposed) return;
    cancel();
    disposed = true;
    onFailure(message);
  };
  return {
    loading() {
      if (disposed) return;
      cancel();
      successes = 0;
      errors = 0;
      timer = setTimeout(() => {
        if (successes) { cancel(); onPartial?.(true); }
        else fail("Карта загружается слишком долго. Показываем сохранённую схему.");
      }, timeoutMs);
    },
    tileLoaded() { if (!disposed) successes++; },
    tileError() { if (!disposed) errors++; },
    loaded() {
      if (disposed) return;
      cancel();
      // Leaflet's load event includes failed tiles. One missing edge tile must
      // not discard an otherwise usable map, but an all-error batch must fail.
      if (errors && !successes) fail("Подробная карта не загрузилась. Показываем сохранённую схему.");
      else onPartial?.(errors > 0);
    },
    error: () => fail("Подробная карта не загрузилась. Показываем сохранённую схему."),
    dispose() { disposed = true; cancel(); },
  };
}
