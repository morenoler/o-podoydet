import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Check, CircleHelp, LoaderCircle, RotateCcw } from "lucide-react";
import type { SearchResult, Trip } from "../../../shared/types";
import { canSearch } from "../search/searchTrip";
import { useSearchConversation } from "./useSearchConversation";
import { Link } from "react-router-dom";
import { accommodationPath } from "../../shared/lib/accommodation";
import { LocationCriteria } from "../places/LocationCriteria";
import { locationState } from "../places/locationPresentation";
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
  const locationNeedsClarification = recommendation?.locationCriteria?.some((criterion) => locationState(criterion) !== "match");
  const recommendedCapacity = recommendation?.room.capacityRule?.maxGuests ?? recommendation?.room.room.capacity;
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
    ? [contextHotelId ? "Что рядом с этим номером?" : "Рядом с кафе", "Кафе не дальше 500 м", "Убери условия рядом"]
    : ["Обязательно стиралка и кухня", "Хочу бассейн и посудомойку", trip.region === "Сочи" ? "Рядом с пляжем" : "Рядом с метро"];
  const lastAssistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  return (
    <aside id="search-side-panel" className="search-conversation" aria-label="Карта и поиск в чате">
      <div className="conversation-tabs" role="group" aria-label="Содержимое боковой панели">
        <button type="button" aria-pressed={mapView} aria-controls="conversation-map" onClick={() => onMapViewChange(true)}>Карта</button>
        <button type="button" aria-pressed={!mapView} aria-controls="conversation-chat" onClick={() => onMapViewChange(false)}>ИИ-ассистент</button>
      </div>
      <div id="conversation-map" className="conversation-map" hidden={!mapView}>{map}</div>
      <div id="conversation-chat" className="conversation-chat" hidden={mapView}>
      {chat.canReset && <div className="conversation-actions">
        <button type="button" onClick={chat.reset} disabled={!chat.canReset}
          title="Очистить диалог и отменить его изменения фильтров. Даты, гости и ручные условия сохранятся.">
          <RotateCcw size={15} aria-hidden="true" />Отменить изменения чата
        </button>
      </div>}
      <div className={`conversation-log${!chat.messages.length ? " is-empty" : ""}`} ref={log} role="log" aria-label="Диалог о подборе номеров" aria-live="polite" aria-relevant="additions text">
        {!chat.messages.length && (
        <div className="conversation-welcome">
          <img src="/images/design/assistant-orb.png" width="131" height="120" alt="" />
          <h3>Расскажите, что для вас важно</h3>
          <p>Помогу подобрать жильё и добавлю ваши пожелания в фильтры.</p>
          {!!trip.preferences.length && <p>Уже выбранные условия сохранены.</p>}
        </div>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} className={`conversation-message is-${message.role}`}>
            <span className="conversation-author">{message.role === "user" ? "Вы" : "Помощник"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {chat.busy && <p className="conversation-pending">Уточняю условия…</p>}
        {recommendation && !!chat.messages.length && (
          <div className="conversation-room-recommendation">
            <p>{trip.pendingLocationQuery ? "По ранее выбранным условиям; новое пожелание нужно уточнить" : locationNeedsClarification ? "Вариант с условиями для уточнения" : "Под выбранные условия"}</p>
            <Link to={accommodationPath(recommendation.hotel, recommendation.room.room.id)}>{recommendation.room.room.name}</Link>
            <span>{recommendation.hotel.name}{recommendedCapacity != null && ` · до ${recommendedCapacity} гостей${recommendation.room.capacityRule ? " по правилу размещения" : ""}`}</span>
            <small>{recommendation.source === "owner" ? "По сведениям отельера" : recommendation.source === "demo" ? "Вымышленный тестовый номер" : "По проверенным данным категории"}. Наличие на даты нужно уточнить.</small>
            <LocationCriteria criteria={recommendation.locationCriteria} />
          </div>
        )}
      </div>
      <div className="conversation-bottom">
        <div className="conversation-search-state" role="status" aria-atomic="true">
          {searching ? <LoaderCircle size={15} aria-hidden="true" /> : searchError || !canSearch(trip) || !result?.roomRecommendations.length ? <CircleHelp size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
          <span>{searchError ? "Подборка не обновилась. Повторите поиск." : searching ? "Обновляем подборку…" : !canSearch(trip) ? "Пожелания можно добавить до выбора дат" : result ? `Категории: ${result.roomRecommendations.length}. Отели без собранных категорий: ${result.hotelCandidates?.length || 0}.` : "Готовы уточнять ваши пожелания"}</span>
        </div>
        <div className="conversation-suggestions" aria-label="Примеры пожеланий">
          {suggestions.map((text) => <button key={text} type="button" disabled={chat.busy} onClick={() => void chat.send(text)}>{text}</button>)}
        </div>
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
          <p id="conversation-hint" className="conversation-hint">{lastAssistant?.mode === "rules" ? "Разбор по правилам. Расположение проверяем по сохранённым данным карты." : lastAssistant?.mode === "deepseek" ? "Запрос разбирает DeepSeek. Расстояния считаются по карте." : lastAssistant?.mode === "local_model" ? "Запрос разбирает локальная модель. Расстояния считаются по карте." : "Добавляйте, уточняйте или убирайте пожелания."}</p>
        </form>
        {result && <button className="conversation-analyze" type="button" onClick={onAnalyze}>Разобрать найденные варианты</button>}
      </div>
      </div>
    </aside>
  );
}
