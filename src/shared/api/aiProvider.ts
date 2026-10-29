export type AiProvider = "local" | "deepseek" | "rules";
export interface AiConfig {
  defaultProvider: AiProvider;
  providers: { id: AiProvider; label: string; available: boolean; reason?: string }[];
}

const storageKey = "o-ai-provider-v1";
const listeners = new Set<() => void>();
export function parseAiProvider(value: unknown): AiProvider | null {
  return value === "local" || value === "deepseek" || value === "rules" ? value : null;
}
function savedProvider(): AiProvider | null {
  try { return parseAiProvider(localStorage.getItem(storageKey)); } catch { return null; }
}
let selected = savedProvider();
export const getAiProvider = () => selected;
export function setAiProvider(value: AiProvider | null) {
  selected = value;
  try {
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch { /* The selection still works for this open tab. */ }
  listeners.forEach(listener => listener());
}
export function subscribeAiProvider(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === storageKey || event.key === null) {
    selected = savedProvider();
    listeners.forEach(listener => listener());
  }
});

/** History, cancellation, authentication and config recovery must remain reachable. */
function modelOperation(path: string) {
  const pathname = path.split("?", 1)[0];
  return /^\/(search(?:\/conversation)?|lab\/search|hotels\/[^/]+\/evaluate|questions(?:\/.*)?|drafts(?:\/.*)?|v2\/(?:questions|host)(?:\/.*)?)$/.test(pathname);
}
export function aiProviderHeaders(path: string, hasBody: boolean, provider: AiProvider | null = selected): Record<string, string> {
  return provider && hasBody && modelOperation(path) ? { "X-AI-Provider": provider } : {};
}

export function aiRequestTimeout(path: string, hasBody: boolean) {
  // A text turn can make two sequential calls, each bounded to at most 180 seconds.
  return hasBody && modelOperation(path) ? 390_000 : 30_000;
}
