import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import type { SearchResult, Trip } from "../../../shared/types";
import { canSearch } from "../search/searchTrip";
import { useSearchConversation } from "./useSearchConversation";
import { ConversationRecommendation } from "./ConversationRecommendation";
import { AiProviderSelect } from "../../shared/ui/AiProviderSelect";
import "./conversation.css";
import "./figcraft-conversation.css";

export function SearchConversation({ trip, onApply, scope, result, searching, searchError, onAnalyze, mapView, onMapViewChange, map, contextHotelId }: {
  trip: Trip;
  onApply: (trip: Trip) => void;
  scope: string;
  result: SearchResult | null;
  searching: boolean;
  searchError: string;
  onAnalyze: () => void;
  mapView: boolean;
  onMapViewChange: (value: boolean) => void;
  map: ReactNode;
  contextHotelId?: string;
}) {
  const chat = useSearchConversation(trip, onApply, scope, contextHotelId);
  const recommendation = !searching && !searchError ? result?.roomRecommendations[0] : undefined;
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (log.current) log.current.scrollTop = chat.messages.length || chat.busy ? log.current.scrollHeight : 0;
  }, [chat.messages, chat.busy, mapView]);
  useEffect(() => {
    const node = log.current;
    if (!node) return;
    let followLatest = chat.messages.length > 0;
    const trackScroll = () => {
      followLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
    };
    const resize = new ResizeObserver(() => {
      if (followLatest) node.scrollTop = node.scrollHeight;
    });
    resize.observe(node);
    node.addEventListener("scroll", trackScroll);
    return () => { resize.disconnect(); node.removeEventListener("scroll", trackScroll); };
  }, [chat.messages.length]);
  const suggestions = [
    { image: "beach", label: "Близость к пляжу", message: "Хочу пляж в пешей доступности" },
    { image: "stroller", label: "Доступность с коляской", message: "Нужен доступ к номеру без ступеней с коляской" },
    { image: "breakfast", label: "Завтраки", message: "Хочу завтрак" },
  ];
  return (
    <aside id="search-side-panel" className="search-conversation" aria-label="Карта и поиск в чате">
      <div className="conversation-tabs" role="group" aria-label="Содержимое боковой панели">
        <button type="button" aria-pressed={mapView} aria-controls="conversation-map" onClick={() => onMapViewChange(true)}><span>Карта</span></button>
        <button type="button" aria-pressed={!mapView} aria-controls="conversation-chat" onClick={() => onMapViewChange(false)}><span>ИИ-Ассистент</span></button>
      </div>
      <div id="conversation-map" className="conversation-map" hidden={!mapView}>{map}</div>
      <div id="conversation-chat" className="conversation-chat" hidden={mapView}>
      <AiProviderSelect disabled={chat.busy || searching} />
      <div className={`conversation-log${!chat.messages.length ? " is-empty" : ""}`} ref={log} role="log" aria-label="Диалог о подборе номеров" aria-live="polite" aria-relevant="additions text">
        {!chat.messages.length && (
        <div className="conversation-welcome">
          <img src="/images/design/assistant-orb.png" width="131" height="120" alt="" />
          <span className="conversation-orb-shadow" aria-hidden="true" />
          <p>{contextHotelId ? <>Отвечу на ваши вопросы об отеле.<br />Если данных не хватит, помогу<br />составить вопрос отельеру.</> : <>Помогу подобрать идеальный отель<br />по одному текстовому запросу</>}</p>
        </div>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} className={`conversation-message is-${message.role}`}>
            <span className="conversation-author">{message.role === "user" ? "Вы" : "Помощник"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {chat.busy && <p className="conversation-pending">Уточняю условия…</p>}
        {!!chat.messages.length && !chat.busy && <div className="conversation-suggestions">
          <p>Можно добавить к пожеланиям:</p>
          <div className="conversation-suggestion-cards" aria-label="Дополнительные пожелания">
            {suggestions.map((item) => <button key={item.image} type="button" onClick={() => void chat.send(item.message)}>
              <span><img src={`/images/design/figcraft-${item.image}.png`} alt="" width="70" height="64" /></span>
              <span>{item.label}</span>
            </button>)}
          </div>
        </div>}
        {recommendation && !!chat.messages.length && (
          <ConversationRecommendation recommendation={recommendation} pendingLocationQuery={trip.pendingLocationQuery} />
        )}
        {(searching || searchError) && <p className={`conversation-search-state${searchError ? " has-error" : ""}`} role="status">
          {searching && <LoaderCircle size={15} aria-hidden="true" />}{searchError ? "Подборка не обновилась. Повторите поиск." : "Обновляем подборку…"}
        </p>}
      </div>
      <div className="conversation-bottom">
        <form className="conversation-form" onSubmit={(event) => { event.preventDefault(); void chat.send(); }}>
          <label htmlFor="hotel-chat-message">Что ещё учесть?</label>
          <div className="conversation-composer">
            <textarea id="hotel-chat-message" rows={1} maxLength={1500} placeholder="Что для вас важно?" value={chat.draft} disabled={chat.busy}
              onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void chat.send();
                }
              }} aria-describedby={chat.error ? "conversation-error" : "conversation-hint"} />
            <button type="submit" aria-label="Отправить пожелание" disabled={chat.busy || !chat.draft.trim()}><ArrowUp size={23} aria-hidden="true" /></button>
          </div>
          {chat.error && <p className="conversation-error" id="conversation-error" role="alert">{chat.error}</p>}
          <p id="conversation-hint" className="conversation-hint">{!canSearch(trip) ? "Пожелания можно добавить до выбора дат." : "Enter — отправить; Shift + Enter — новая строка."}</p>
        </form>
      </div>
      </div>
    </aside>
  );
}
