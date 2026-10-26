import { useEffect, useRef, type ReactNode } from "react";
import { Send, Check, RotateCcw } from "lucide-react";
import type { SearchResult, Trip } from "../../../shared/types";
import { canSearch } from "../search/searchTrip";
import { useSearchConversation } from "./useSearchConversation";
import { Link } from "react-router-dom";
import { accommodationPath } from "../../shared/lib/accommodation";
import "./conversation.css";

export function SearchConversation({ trip, onApply, scope, result, searching, searchError, onAnalyze, mapView, onMapViewChange, map }: {
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
}) {
  const chat = useSearchConversation(trip, onApply, scope);
  const recommendation = !searching && !searchError ? result?.roomRecommendations[0] : undefined;
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (log.current) log.current.scrollTop = chat.messages.length || chat.busy ? log.current.scrollHeight : 0;
  }, [chat.messages, chat.busy, mapView, recommendation?.id]);
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
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
  const suggestions = chat.messages.length
    ? ["Ещё окна во двор", "Тишина обязательна", "Пляж не обязателен"]
    : ["Хочу поближе к морю", "Важно, чтобы было тихо", "Еду с ребёнком"];
  return (
    <aside id="search-side-panel" className="search-conversation" aria-label="Карта и ИИ-ассистент">
      <div className="conversation-tabs" role="group" aria-label="Содержимое боковой панели">
        <button type="button" aria-pressed={mapView} aria-controls="conversation-map" onClick={() => onMapViewChange(true)}>Карта</button>
        <button type="button" aria-pressed={!mapView} aria-controls="conversation-chat" onClick={() => onMapViewChange(false)}>ИИ-ассистент</button>
      </div>
      <div id="conversation-map" className="conversation-map" hidden={!mapView}>{map}</div>
      <div id="conversation-chat" className="conversation-chat" hidden={mapView}>
      <div className="conversation-actions">
        <button type="button" onClick={chat.reset} disabled={!chat.canReset}
          title="Очистить диалог и отменить его изменения фильтров. Даты, гости и ручные условия сохранятся.">
          <RotateCcw size={15} aria-hidden="true" />Сбросить чат и фильтры
        </button>
      </div>
      <div className="conversation-log" ref={log} role="log" aria-label="Диалог о подборе номеров" aria-live="polite" aria-relevant="additions text">
        {!chat.messages.length && (
        <div className="conversation-welcome">
          <h3>Начнём с того, что важно вам</h3>
          <p>Расскажите, какой номер вам нужен. Можно по одному пожеланию: подберём категорию, в которой совпадут все ваши условия.</p>
          {!!trip.preferences.length && <p>Уже выбранные условия сохранены. Добавьте что-нибудь ещё или уточните их.</p>}
        </div>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} className={`conversation-message is-${message.role}`}>
            <span className="conversation-author">{message.role === "user" ? "Вы" : "Помощник"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {chat.busy && <p className="conversation-pending">Уточняю условия…</p>}
        {recommendation && (
          <div className="conversation-room-recommendation">
            <p>Под все выбранные условия</p>
            <Link to={accommodationPath(recommendation.hotel, recommendation.room.room.id)}>{recommendation.room.room.name}</Link>
            <span>{recommendation.hotel.name} · до {recommendation.room.room.capacity} гостей</span>
            <small>{recommendation.source === "owner" ? "По сведениям отельера" : recommendation.source === "demo" ? "Вымышленный тестовый номер" : "По проверенным данным категории"}. Наличие на даты нужно уточнить.</small>
          </div>
        )}
      </div>
      <div className="conversation-bottom">
        <div className="conversation-search-state" role="status" aria-atomic="true">
          <Check size={15} aria-hidden="true" />
          <span>{searchError ? "Подборка не обновилась. Повторите поиск." : searching ? "Подбираем конкретные номера…" : !canSearch(trip) ? "Пожелания можно добавить до выбора дат" : result ? result.roomRecommendations.length ? `Номеров под все условия: ${result.roomRecommendations.length}` : "Номер под все условия пока не найден" : "Готовы уточнять ваши пожелания"}</span>
        </div>
        <div className="conversation-suggestions" aria-label="Примеры пожеланий">
          {suggestions.map((text) => <button key={text} type="button" disabled={chat.busy} onClick={() => void chat.send(text)}>{text}</button>)}
        </div>
        <form className="conversation-form" onSubmit={(event) => { event.preventDefault(); void chat.send(); }}>
          <label htmlFor="hotel-chat-message">Что ещё учесть?</label>
          <div className="conversation-composer">
            <textarea id="hotel-chat-message" rows={2} maxLength={1500} placeholder="Напишите сообщение" value={chat.draft} disabled={chat.busy}
              onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void chat.send();
                }
              }} aria-describedby={chat.error ? "conversation-error" : "conversation-hint"} />
            <button type="submit" aria-label="Отправить пожелание" disabled={chat.busy || !chat.draft.trim()}><Send size={23} aria-hidden="true" /></button>
          </div>
          {chat.error && <p className="conversation-error" id="conversation-error" role="alert">{chat.error}</p>}
          <p id="conversation-hint" className="conversation-hint">{lastAssistant?.mode === "rules" ? "Разбор по правилам. Учитываем знакомые условия." : "Добавляйте, уточняйте или убирайте условия."}</p>
        </form>
        {result && <button className="conversation-analyze" type="button" onClick={onAnalyze}>Разобрать найденные варианты</button>}
      </div>
      </div>
    </aside>
  );
}
