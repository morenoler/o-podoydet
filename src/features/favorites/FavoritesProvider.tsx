import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { FavoriteItem, Shortlist, ShortlistStage } from "../../../shared/shortlist";
import type { Trip } from "../../../shared/types";
import { useApp } from "../../app/providers/TripProvider";
import { useAuth } from "../auth/AuthProvider";
import { emptyShortlist, importShortlist, mergeShortlistItems, parseShortlist, safeFavorite, shortlistTrip } from "./shortlistState";
import { shortlistApi, ShortlistError } from "./shortlistApi";
export type { FavoriteItem } from "../../../shared/shortlist";

function local(scope: string): Shortlist {
  try {
    const saved = localStorage.getItem(`o-shortlist-v1:${scope}`);
    if (saved) return parseShortlist(JSON.parse(saved));
    return parseShortlist({ ...emptyShortlist(), items: JSON.parse(localStorage.getItem(`o-favorites-v2:${scope}`) || "[]") });
  } catch { return emptyShortlist(); }
}
function browserShortlist(scope: string): Shortlist {
  const own = local(scope), guest = local("guest");
  const source = own.items.length ? own : guest;
  return { ...source, items: mergeShortlistItems(own.items, guest.items) };
}
interface FavoritesContext {
  items: FavoriteItem[];
  shortlist: Shortlist;
  isFavorite: (id: string) => boolean;
  toggle: (item: FavoriteItem) => void;
  updateItem: (id: string, note: string, stage: ShortlistStage) => Promise<boolean>;
  updateTrip: (trip: Trip) => Promise<boolean>;
  rename: (title: string) => Promise<boolean>;
  importBrowser: () => Promise<boolean>;
  importCount: number;
  remote: boolean;
  loading: boolean;
  saving: boolean;
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  share: () => Promise<{ token: string; expiresAt: string }>;
  revokeShare: () => Promise<void>;
}
const Context = createContext<FavoritesContext | null>(null);

export function FavoritesProvider({ children, scope = "guest" }: { children: ReactNode; scope?: string }) {
  const { trip, effectivePreferences } = useApp();
  const { loading: authLoading } = useAuth();
  const remote = scope !== "guest";
  const [shortlist, setShortlist] = useState(() => remote ? emptyShortlist() : local(scope));
  const current = useRef(shortlist);
  const alive = useRef(true);
  const busy = useRef(false);
  const generation = useRef(0);
  const [loading, setLoading] = useState(remote);
  const [ready, setReady] = useState(!remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [browserSaved, setBrowserSaved] = useState(() => remote ? browserShortlist(scope) : emptyShortlist());
  const accept = (value: Shortlist) => { current.current = value; if (alive.current) setShortlist(value); };
  async function refresh() {
    if (busy.current) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const value = remote ? parseShortlist(await shortlistApi.get()) : local(scope);
      if (alive.current && request === generation.current) { accept(value); setReady(true); setError(""); }
    } catch (failure) {
      if (alive.current && request === generation.current) setError((failure as Error).message);
    } finally { if (alive.current && request === generation.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    if (remote) void refresh();
    const changed = (event: StorageEvent) => {
      if (!remote && (event.key === `o-shortlist-v1:${scope}` || event.key === `o-favorites-v2:${scope}`)) accept(local(scope));
      if (remote && event.key?.startsWith("o-shortlist-v1:")) setBrowserSaved(browserShortlist(scope));
    };
    const focused = () => { if (!busy.current && remote) void refresh(); };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", focused);
    return () => { alive.current = false; ++generation.current; window.removeEventListener("storage", changed); window.removeEventListener("focus", focused); };
  }, [scope]);

  async function change(edit: (value: Shortlist) => Shortlist): Promise<boolean> {
    if (busy.current || !ready || authLoading) return false;
    const request = ++generation.current;
    busy.current = true; setLoading(false); setSaving(true); setError("");
    try {
      const next = edit(remote ? current.current : local(scope));
      if (remote) {
        const value = parseShortlist(await shortlistApi.save(next));
        if (alive.current && request === generation.current) accept(value);
      } else {
        const value = { ...next, revision: next.revision + 1, updatedAt: new Date().toISOString() };
        // Failed storage keeps the previous state; no claim that notes were saved.
        localStorage.setItem(`o-shortlist-v1:${scope}`, JSON.stringify(value));
        accept(value);
      }
      return true;
    } catch (failure) {
      if (alive.current && request === generation.current) {
        setError(failure instanceof ShortlistError ? failure.message : remote ? "Нет связи с сервером. Изменение не сохранено; повторите попытку." : "Браузер не смог сохранить подборку. Освободите место или разрешите хранение данных и повторите попытку.");
        if (failure instanceof ShortlistError && failure.status === 409) {
          try { const fresh = await shortlistApi.get(); if (alive.current && request === generation.current) accept(parseShortlist(fresh)); } catch { /* Keep visible draft and error. */ }
        }
      }
      return false;
    } finally { busy.current = false; if (alive.current && request === generation.current) setSaving(false); }
  }
  const snapshotTrip = () => shortlistTrip({ ...trip, preferences: effectivePreferences });
  // Session revalidation keeps the old user object temporarily. Do not expose that
  // account's notes or enable share mutations until the cookie has been checked.
  const visible = authLoading ? emptyShortlist() : shortlist;
  return <Context.Provider value={{
    items: visible.items, shortlist: visible, remote, loading: loading || authLoading, saving, ready: ready && !authLoading,
    error: authLoading ? "" : error, refresh,
    importCount: authLoading ? 0 : browserSaved.items.filter((item) => !visible.items.some((saved) => saved.id === item.id)).length,
    isFavorite: (id) => visible.items.some((item) => item.id === id),
    toggle: (item) => {
      const safe = safeFavorite(item);
      if (!safe) { setError("Не удалось сохранить этот вариант."); return; }
      if (!current.current.items.some((value) => value.id === item.id) && current.current.items.length >= 200) { setError("В подборке уже 200 вариантов. Удалите один, чтобы добавить новый."); return; }
      void change((value) => ({ ...value, trip: value.trip || snapshotTrip(), items: value.items.some((saved) => saved.id === item.id) ? value.items.filter((saved) => saved.id !== item.id) : [...value.items, { ...safe, savedAt: new Date().toISOString() }] }));
    },
    updateItem: (id, note, stage) => change((value) => ({ ...value, items: value.items.map((item) => item.id === id ? { ...item, note: note.slice(0, 1500), stage } : item) })),
    updateTrip: (value) => change((saved) => ({ ...saved, trip: shortlistTrip(value) })),
    rename: (title) => change((value) => ({ ...value, title: title.trim().slice(0, 100) || value.title })),
    importBrowser: () => change((value) => importShortlist(value, browserShortlist(scope))),
    share: async () => {
      if (!remote || busy.current || !ready || authLoading) throw new Error("Дождитесь проверки аккаунта и сохранения подборки.");
      const request = ++generation.current;
      busy.current = true; setSaving(true); setLoading(false);
      try {
        const result = await shortlistApi.share(current.current.revision);
        if (alive.current && request === generation.current) accept({ ...current.current, shareActive: true });
        return result;
      } catch (failure) {
        if (failure instanceof ShortlistError && failure.status === 409) {
          const fresh = await shortlistApi.get();
          if (alive.current && request === generation.current) accept(parseShortlist(fresh));
        }
        throw failure;
      } finally { busy.current = false; if (alive.current && request === generation.current) setSaving(false); }
    },
    revokeShare: async () => {
      if (!remote || busy.current || !ready || authLoading) throw new Error("Дождитесь проверки аккаунта и сохранения подборки.");
      const request = ++generation.current;
      busy.current = true; setSaving(true); setLoading(false);
      try {
        await shortlistApi.revoke();
        if (alive.current && request === generation.current) accept({ ...current.current, shareActive: false });
      } finally { busy.current = false; if (alive.current && request === generation.current) setSaving(false); }
    },
  }}>{children}</Context.Provider>;
}

export function useFavorites() {
  const value = useContext(Context);
  if (!value) throw new Error("FavoritesProvider is required");
  return value;
}
