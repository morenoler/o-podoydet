import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleHelp, Copy, ExternalLink, MessageCircleQuestion, X } from "lucide-react";
import type { Hotel, HotelMatch, Room, RoomMatch, Trip } from "../../../shared/types";
import { availabilityQuestion, decisionSteps, hasUncheckedPersonalWishes, officialRoomUrl } from "./decisionSteps";
import { canSearch } from "../search/searchTrip";
import "./decision-steps.css";

export function DecisionNextSteps({ match, room, trip, connected = false }: {
  match: HotelMatch; room: RoomMatch; trip: Trip; connected?: boolean;
}) {
  const id = useId();
  const steps = decisionSteps(match, room, trip);
  const unresolved = steps.filter((item) => item.state !== "match");
  const blocked = unresolved.some((item) => item.required && ["mismatch", "conflict"].includes(item.state));
  return (
    <section id="decision-next-steps" className="decision-next-steps" aria-labelledby={id}>
      <div className="decision-next-heading">
        <MessageCircleQuestion size={26} aria-hidden="true" />
        <div>
          <h2 id={id}>{blocked ? "Есть препятствие для вашей поездки" : unresolved.length ? "Что проверить перед выбором" : "Осталось уточнить наличие и цену"}</h2>
          <p>{steps.filter((item) => item.state === "match").length} из {steps.length} условий совпали по доступным сведениям. Наличие на даты ещё не проверено.</p>
        </div>
      </div>
      {unresolved.length > 0 && <ul className="decision-checklist">
        {unresolved.map((item) => <li key={item.id} className={`is-${item.state}`}>
          {item.state === "mismatch" ? <X size={19} aria-hidden="true" /> : <CircleHelp size={19} aria-hidden="true" />}
          <div><strong>{item.label}{item.required && <span>Обязательно</span>}</strong>
            <p>{item.state === "mismatch" ? "Есть несоответствие. " : item.state === "conflict" ? "Источники противоречат друг другу. " : "Нужно уточнить. "}{item.explanation}</p>
          </div>
        </li>)}
      </ul>}
      {blocked && <p className="decision-blocked">Этот вариант не удовлетворяет обязательным условиям. Ответ о наличии не устранит несоответствие; выберите другой вариант или явно измените пожелания.</p>}
      <div className="decision-actions">
        {blocked ? <Link className="button primary" to="/results">Вернуться к вариантам</Link>
          : connected ? <a className="button primary" href="#listing-booking">Уточнить наличие и стоимость</a>
          : match.hotel.synthetic ? <p>Это вымышленный пример. Реальное наличие и отправка запроса здесь недоступны.</p>
          : <a className="button primary" href="#availability-request">Подготовить запрос в отель</a>}
        {connected && <a className="button secondary" href="#listing-fit-question">Личное уточнение условий</a>}
      </div>
      <p className="decision-source-note">Совпадение по источникам не означает проверку на месте. Сведения отельера отмечены отдельно в подробностях условий.</p>
    </section>
  );
}

export function CatalogAvailability({ hotel, room, trip, match, roomMatch }: {
  hotel: Hotel; room: Room; trip: Trip; match?: HotelMatch; roomMatch?: RoomMatch;
}) {
  const titleId = useId();
  const source = officialRoomUrl(room.sourceUrl);
  const [open, setOpen] = useState(false);
  return <section id="availability-request" className="catalog-availability" aria-labelledby={titleId}>
    <h2 id={titleId}>Наличие и итоговая стоимость</h2>
    <p>В каталоге нет актуального предложения на ваши даты. Подготовьте запрос для категории «{room.name}» и уточните условия у отеля.</p>
    {!canSearch(trip) && <p>Для точного запроса сначала выберите даты и гостей в строке поиска.</p>}
    {hasUncheckedPersonalWishes(trip, match) && <p className="decision-source-note">В черновик попадут только выбранные и распознанные условия. Свободный текст пожелания и переписка не переносятся. Проверьте запрос и самостоятельно добавьте детали, которые хотите сообщить отелю.</p>}
    <div className="decision-actions">
      <button type="button" className="button primary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Скрыть запрос" : "Подготовить запрос"}</button>
      {source && <a className="button secondary" href={source} target="_blank" rel="noreferrer">Сайт отеля <ExternalLink size={16} aria-hidden="true" /></a>}
    </div>
    {open && <RequestDraft key={`${room.id}:${JSON.stringify(trip)}`} initialText={availabilityQuestion(`${room.name}, ${hotel.name}`, trip, match, roomMatch)} />}
    <p className="decision-source-note">Это черновик для самостоятельной отправки. Нажатие кнопки не отправляет сообщение и не бронирует номер.</p>
  </section>;
}

function RequestDraft({ initialText }: { initialText: string }) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setManual(false); }
    catch { ref.current?.focus(); ref.current?.select(); setManual(true); }
  }
  return <div className="availability-draft">
    <label className="field"><span>Проверьте текст перед отправкой</span><textarea ref={ref} rows={8} maxLength={3000} value={text} onChange={(event) => { setText(event.target.value); setCopied(false); setManual(false); }} /></label>
    <button className="button secondary" type="button" disabled={!text.trim()} onClick={() => void copy()}>{copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}{copied ? "Скопировано" : "Скопировать запрос"}</button>
    <p role="status">{copied ? "Текст скопирован. Сообщение не отправлено." : manual ? "Текст выделен. Скопируйте его вручную." : "Можно дополнить запрос перед копированием."}</p>
  </div>;
}
