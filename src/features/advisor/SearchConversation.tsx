import { useEffect, useRef, type ReactNode } from "react";
import { Send, RotateCcw } from "lucide-react";
import type { SearchResult, Trip } from "../../../shared/types";
import { canSearch } from "../search/searchTrip";
import { useSearchConversation } from "./useSearchConversation";
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
  const suggestions = chat.messages.length
    ? ["Убери бюджет", "Тишина не обязательна"]
    : ["До пляжа 500 м", "До 100000 KRW за ночь", "Ищи «балкон»"];
  return (
    <aside id="search-side-panel" className="search-conversation" aria-label="Карта и поиск в чате">
      <div className="conversation-tabs" role="group" aria-label="Содержимое боковой панели">
        <button type="button" aria-pressed={mapView} aria-controls="conversation-map" onClick={() => onMapViewChange(true)}>Карта</button>
        <button type="button" aria-pressed={!mapView} aria-controls="conversation-chat" onClick={() => onMapViewChange(false)}>Поиск в чате</button>
      </div>
      <div id="conversation-map" className="conversation-map" hidden={!mapView}>{map}</div>
      <div id="conversation-chat" className="conversation-chat" hidden={mapView}>
      {chat.canReset && <div className="conversation-actions">
        <button type="button" onClick={chat.reset} disabled={!chat.canReset}
          title="Очистить диалог и отменить его изменения фильтров. Даты, гости и ручные условия сохранятся.">
          <RotateCcw size={15} aria-hidden="true" />Отменить изменения чата
        </button>
      </div>}
      <div className="conversation-log" ref={log} role="log" aria-label="Диалог о подборе номеров" aria-live="polite" aria-relevant="additions text">
        {!chat.messages.length && (
        <div className="conversation-welcome">
          <h3>Какой отель ищем?</h3>
          <p>Уточните бюджет в вонах, расстояние до пляжа или тип жилья. Для поиска по описаниям напишите: ищи «балкон».</p>
          <p>Можно добавить этаж и направление окон. Если данных для пожелания нет, мы сообщим об этом.</p>
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
      </div>
      <div className="conversation-bottom">
        <div className="conversation-search-state" role="status" aria-atomic="true">
          <span>{searchError ? "Подборка не обновилась. Повторите поиск." : searching ? "Обновляем подборку…" : !canSearch(trip) ? "Пожелания можно добавить до выбора дат" : result ? `Категорий под все условия: ${result.roomRecommendations.length}.${result.roomAlternatives?.length ? ` Требуют уточнения: ${result.roomAlternatives.length}.` : ""}` : "Добавьте пожелание, чтобы уточнить поиск"}</span>
        </div>
        <div className="conversation-suggestions" aria-label="Примеры пожеланий">
          {suggestions.map((text) => <button key={text} type="button" disabled={chat.busy} onClick={() => void chat.send(text)}>{text}</button>)}
        </div>
        <form className="conversation-form" onSubmit={(event) => { event.preventDefault(); void chat.send(); }}>
          <label htmlFor="hotel-chat-message">Что ещё учесть?</label>
          <div className="conversation-composer">
            <textarea id="hotel-chat-message" rows={2} maxLength={1500} placeholder="Например, только апартаменты" value={chat.draft} disabled={chat.busy}
              onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void chat.send();
                }
              }} aria-describedby={chat.error ? "conversation-error" : "conversation-hint"} />
            <button type="submit" aria-label="Отправить пожелание" disabled={chat.busy || !chat.draft.trim()}><Send size={23} aria-hidden="true" /></button>
          </div>
          {chat.error && <p className="conversation-error" id="conversation-error" role="alert">{chat.error}</p>}
          <p id="conversation-hint" className="conversation-hint">Применённые условия перечислим в ответе. Поиск слов не подтверждает удобства.</p>
        </form>
        {result && <button className="conversation-analyze" type="button" onClick={onAnalyze}>Разобрать найденные варианты</button>}
      </div>
      </div>
    </aside>
  );
}
