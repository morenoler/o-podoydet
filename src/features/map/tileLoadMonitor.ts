/** Every new viewport load has a deadline; disposal cancels pending fallback. */
export function tileLoadMonitor(onFailure: (message: string) => void, timeoutMs = 12_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
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
      timer = setTimeout(() => fail("Карта загружается слишком долго. Показываем сохранённую схему."), timeoutMs);
    },
    loaded: cancel,
    error: () => fail("Подробная карта не загрузилась. Показываем сохранённую схему."),
    dispose() { disposed = true; cancel(); },
  };
}
