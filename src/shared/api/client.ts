export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }); } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new Error(timedOut ? "Сервер не успел ответить. Попробуйте ещё раз." : "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Сервер временно недоступен. Попробуйте ещё раз."); }
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "Не удалось загрузить данные. Попробуйте ещё раз.",
    );
  return data;
}
