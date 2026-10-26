import { useEffect, useRef, useState } from "react";
import type { FeatureId, Trip } from "../../../shared/types";
import { featureIds } from "../../../shared/features";
import { api } from "../../shared/api/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: "rules" | "llm";
}
interface Conversation {
  messages: Message[];
  focusFeatures: FeatureId[];
}
interface Reply {
  trip: Trip;
  message: string;
  warnings: string[];
  mode: "rules" | "llm";
  focusFeatures: FeatureId[];
  changed: boolean;
}
const empty: Conversation = { messages: [], focusFeatures: [] };

function readConversation(key: string, trip: Trip): Conversation & { draft?: string } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved?.tripKey !== JSON.stringify(trip) || !Array.isArray(saved.messages) || !Array.isArray(saved.focusFeatures)) return empty;
    if (!saved.messages.every((m: Message) => typeof m.id === "string" && typeof m.text === "string" && ["user", "assistant"].includes(m.role))) return empty;
    if (!saved.focusFeatures.every((f: FeatureId) => featureIds.includes(f))) return empty;
    return { messages: saved.messages.slice(-60), focusFeatures: saved.focusFeatures,
      draft: typeof saved.draft === "string" ? saved.draft.slice(0, 1500) : "" };
  } catch { return empty; }
}

export function useSearchConversation(trip: Trip, onApply: (trip: Trip) => void, scope: string) {
  const storageKey = `o-search-conversation-busan:${scope}`;
  const [initial] = useState(() => readConversation(storageKey, trip));
  const [conversation, setConversation] = useState<Conversation>(initial);
  const [draft, setDraft] = useState(initial.draft || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latestTrip = useRef(trip);
  latestTrip.current = trip;
  const request = useRef<symbol | null>(null);
  const pendingTurn = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => () => { request.current = null; }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        ...conversation,
        // Interrupted requests come back as retryable drafts, not unanswered history.
        messages: conversation.messages.filter((message) => message.id !== pendingTurn.current?.id),
        draft: pendingTurn.current?.text || draft,
        tripKey: JSON.stringify(trip),
      }));
    } catch { /* The conversation still works when browser storage is unavailable. */ }
  }, [storageKey, conversation, trip, draft, busy]);

  async function send(text = draft) {
    const message = text.trim();
    if (!message || request.current || message.length > 1500) return;
    const token = Symbol();
    request.current = token;
    const snapshot = JSON.stringify(trip);
    const id = crypto.randomUUID();
    pendingTurn.current = { id, text: message };
    setError("");
    setBusy(true);
    setDraft("");
    setConversation((previous) => ({ ...previous, messages: [...previous.messages, { id, role: "user", text: message }].slice(-60) as Message[] }));
    try {
      const reply = await api<Reply>("/search/conversation", { trip, message, focusFeatures: conversation.focusFeatures });
      if (request.current !== token) return;
      if (JSON.stringify(latestTrip.current) !== snapshot)
        throw new Error("Условия поиска изменились, пока готовился ответ. Отправьте пожелание ещё раз для текущей подборки.");
      if (reply.changed) onApply(reply.trip);
      setConversation((previous) => ({
        focusFeatures: reply.focusFeatures,
        messages: [...previous.messages, {
          id: crypto.randomUUID(), role: "assistant", mode: reply.mode,
          text: [reply.message, ...reply.warnings].join("\n\n"),
        }].slice(-60) as Message[],
      }));
    } catch (cause) {
      if (request.current !== token) return;
      setConversation((previous) => ({ ...previous, messages: previous.messages.filter((m) => m.id !== id) }));
      setDraft(message);
      setError(cause instanceof Error ? cause.message : "Не удалось применить пожелание. Попробуйте ещё раз.");
    } finally {
      if (request.current === token) {
        request.current = null;
        pendingTurn.current = null;
        setBusy(false);
      }
    }
  }

  return { ...conversation, draft, setDraft, busy, error, send };
}
