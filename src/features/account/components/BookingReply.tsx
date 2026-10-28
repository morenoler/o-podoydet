import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import type { Booking } from "../../../../shared/account";
import { propertyTimeZone } from "../../../../shared/regions";
import { accountApi } from "../api";
import "../booking-reply.css";

function replyDate(value: string | undefined, city: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: propertyTimeZone(city) }).format(new Date(value));
}

export function BookingReply({ booking, host, disabled = false, onBusyChange }: {
  booking: Booking; host: boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const [published, setPublished] = useState({ message: booking.hostReply || "", date: booking.repliedAt });
  const [draft, setDraft] = useState(booking.hostReply || "");
  const [open, setOpen] = useState(host && !!booking.note && !booking.hostReply);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || disabled || !draft.trim() || draft.length > 3000) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(""); setSaved(false);
    try {
      const updated = await accountApi.replyToBooking(booking.id, draft.trim());
      if (!mounted.current) return;
      setPublished({ message: updated.hostReply || "", date: updated.repliedAt });
      setDraft(updated.hostReply || ""); setOpen(false); setSaved(true);
    } catch (failure) {
      if (mounted.current) { setError((failure as Error).message); requestAnimationFrame(() => feedback.current?.focus()); }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); onBusyChange?.(false); }
    }
  }
  if (!host && !booking.note && !published.message) return null;
  return <section className="booking-correspondence" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><MessageCircle size={18} aria-hidden="true" />{host ? "Вопросы гостя и ваш ответ" : "Вопросы и ответ отельера"}</h3>
    {booking.note && <div className="booking-private-message"><strong>{host ? "Гость написал" : "Ваш запрос"}</strong><p>{booking.note}</p></div>}
    {published.message ? <div className="booking-private-message is-host"><strong>{host ? "Ваш ответ гостю" : "Ответ отельера"}</strong><p>{published.message}</p>{published.date && <time dateTime={published.date}>{replyDate(published.date, booking.city)} · {booking.city}</time>}</div>
      : !host && <p className="booking-reply-pending">Отельер ещё не ответил на вопросы.</p>}
    {host && <>
      <button className="text-link" type="button" disabled={busy || disabled} aria-expanded={open} aria-controls={`${id}-form`} onClick={() => { setOpen(!open); setSaved(false); }}>{open ? "Скрыть форму ответа" : published.message ? "Изменить ответ" : "Ответить гостю"}</button>
      {open && <form id={`${id}-form`} className="booking-reply-form" onSubmit={submit}>
        <label className="field"><span>Уточните наличие, полную стоимость и условия</span><textarea rows={5} maxLength={3000} required value={draft} disabled={busy || disabled} aria-describedby={`${id}-privacy${error ? ` ${id}-error` : ""}`} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} placeholder="Например: доступен ли вариант на указанные даты, есть ли доплаты, какие условия отмены и удобства." /></label>
        <p id={`${id}-privacy`} className="booking-reply-help">Ответ увидит только гость этой заявки. {published.message ? "Новый текст заменит ваш предыдущий ответ." : "Текст не публикуется в объявлении."}</p>
        {error && <p ref={feedback} id={`${id}-error`} className="booking-reply-error" role="alert" tabIndex={-1}>{error}</p>}
        <button type="submit" className="button secondary" disabled={busy || disabled || !draft.trim()}>{busy ? "Отправляем ответ…" : "Отправить ответ гостю"}</button>
      </form>}
      {saved && <p className="booking-reply-saved" role="status">Ответ сохранён в заявке и доступен гостю.</p>}
    </>}
    {published.message && <p className="booking-reply-help">Ответ не меняет статус заявки или расчёт по цене объявления. Условия из переписки не считаются проверенными фактами; оплата через сервис не производится.</p>}
  </section>;
}
