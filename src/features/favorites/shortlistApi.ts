import type { SharedShortlist, Shortlist } from "../../../shared/shortlist";

export class ShortlistError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try { data = await response.json(); } catch { throw new ShortlistError("Не удалось загрузить подборку. Повторите попытку.", response.status); }
  if (!response.ok) throw new ShortlistError(data.error || "Не удалось сохранить подборку. Повторите попытку.", response.status);
  return data;
}
export const shortlistApi = {
  get: () => request<Shortlist>("/account/shortlist"),
  save: (value: Shortlist) => request<Shortlist>("/account/shortlist", value),
  share: (revision: number) => request<{ token: string; expiresAt: string }>("/account/shortlist/share", { revision }),
  revoke: () => request<{ ok: boolean }>("/account/shortlist/revoke", {}),
  shared: (token: string) => request<SharedShortlist>(`/shortlists/${encodeURIComponent(token)}`),
};
