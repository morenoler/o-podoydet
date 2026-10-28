import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bookmark, Check, Clipboard, Cloud, Heart, NotebookPen, RefreshCw, Share2 } from "lucide-react";
import type { FavoriteItem, SharedShortlist, ShortlistStage } from "../../shared/shortlist";
import { shortlistStages } from "../../shared/shortlist";
import { features } from "../../shared/features";
import { useApp } from "../app/providers/TripProvider";
import { useFavorites } from "../features/favorites/FavoritesProvider";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import { AccommodationPhoto } from "../shared/ui/AccommodationPhoto";
import { Modal } from "../shared/ui/Modal";
import { dateFull } from "../shared/lib/date";
import "../features/favorites/shortlist.css";

export function SavedTripSummary({ trip }: { trip: SharedShortlist["trip"] }) {
  if (!trip) return <p className="shortlist-muted">Даты и пожелания пока не сохранены.</p>;
  return <div className="shortlist-trip-summary">
    <p><strong>{trip.region}</strong><span>{trip.checkIn && trip.checkOut ? `${dateFull(trip.checkIn)} — ${dateFull(trip.checkOut)}` : "Даты ещё не выбраны"}</span><span>{trip.adults} взр.{trip.children > 0 ? `, ${trip.children} дет.` : ""}</span></p>
    {trip.preferences.length > 0 && <ul aria-label="Сохранённые пожелания">{trip.preferences.map((preference) => <li key={preference.feature}>{features[preference.feature]?.label || preference.feature}{preference.required && <strong>обязательно</strong>}</li>)}</ul>}
  </div>;
}

function SavedOption({ item }: { item: FavoriteItem }) {
  const { updateItem, saving } = useFavorites();
  const [note, setNote] = useState(item.note || "");
  const [stage, setStage] = useState<ShortlistStage>(item.stage || "considering");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) { setNote(item.note || ""); setStage(item.stage || "considering"); }
  }, [item.note, item.stage, dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    if (await updateItem(item.id, note, stage)) { setSaved(true); setDirty(false); }
  }
  return <article className="shortlist-option">
    <div className="shortlist-option-photo">
      <Link to={item.path} tabIndex={-1} aria-hidden="true"><AccommodationPhoto name={item.name} hotelId={item.hotelId} photos={item.photos} /></Link>
      <FavoriteButton item={item} />
    </div>
    <div className="shortlist-option-body">
      <div><h2><Link to={item.path}>{item.name}</Link></h2>{item.address && <p className="shortlist-muted">{item.address}</p>}</div>
      <p className="shortlist-caution">Цена, наличие и условия требуют актуальной проверки.</p>
      <form onSubmit={(event) => void save(event)}>
        <label className="field"><span>Мой следующий шаг</span><select value={stage} disabled={saving} onChange={(event) => { setStage(event.target.value as ShortlistStage); setDirty(true); setSaved(false); }}>{Object.entries(shortlistStages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span>Личная заметка</span><textarea rows={2} maxLength={1500} disabled={saving} placeholder="Что нравится и что нужно уточнить" value={note} onChange={(event) => { setNote(event.target.value); setDirty(true); setSaved(false); }} /></label>
        <div className="shortlist-option-actions"><button className="button secondary" type="submit" disabled={saving || !dirty}>{saved ? <Check size={17} aria-hidden="true" /> : <NotebookPen size={17} aria-hidden="true" />}{saved ? "Сохранено" : saving ? "Сохраняем…" : "Сохранить изменения"}</button><Link className="button primary" to={item.path}>Проверить вариант</Link></div>
        <span className={dirty ? "shortlist-muted" : "sr-only"} role="status">{saved ? "Заметка и следующий шаг сохранены" : dirty ? "Изменения ещё не сохранены." : ""}</span>
      </form>
    </div>
  </article>;
}

function ShareShortlist({ onClose }: { onClose: () => void }) {
  const { shortlist, share, revokeShare } = useFavorites();
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function create() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await share();
      setLink(`${window.location.origin}/shortlists/${result.token}`); setExpiresAt(result.expiresAt);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError("");
    try { await revokeShare(); setLink(""); setMessage("Доступ по прежней ссылке закрыт."); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title="Поделиться подборкой" className="shortlist-share-modal">
    <p>По ссылке будут доступны название подборки, даты, гости, выбранные фильтры и карточки. Личные заметки, текст пожеланий, места из диалога и переписки останутся у вас.</p>
    <div className="shortlist-share-preview"><h3>{shortlist.title}</h3><SavedTripSummary trip={shortlist.trip} /><ul>{shortlist.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul></div>
    <p className="shortlist-muted">Это копия на момент создания ссылки, только для чтения. Ссылка действует 30 дней; открыть её сможет любой, кому вы её передадите. Новая ссылка закрывает прежнюю.</p>
    {error && <p role="alert" className="shortlist-error">{error}</p>}
    {link ? <div className="shortlist-share-result"><label className="field"><span>Ссылка на подборку</span><input readOnly value={link} onFocus={(event) => event.target.select()} /></label><button type="button" className="button primary" onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage("Ссылка скопирована."); } catch { setMessage("Выделите ссылку и скопируйте её вручную."); } }}><Clipboard size={18} aria-hidden="true" />Скопировать</button><a href={link} target="_blank" rel="noreferrer">Открыть копию</a><small>Доступна до {new Date(expiresAt).toLocaleDateString("ru-RU")}</small></div> : <button className="button primary" type="button" disabled={busy} onClick={() => void create()}><Share2 size={18} aria-hidden="true" />{busy ? "Создаём ссылку…" : "Создать ссылку на эту копию"}</button>}
    {shortlist.shareActive && <button type="button" className="button secondary shortlist-revoke" disabled={busy} onClick={() => void revoke()}>Закрыть доступ по ссылке</button>}
    <p role="status">{message}</p>
  </Modal>;
}

export function FavoritesPage() {
  const saved = useFavorites();
  const { trip, effectivePreferences, setTrip } = useApp();
  const navigate = useNavigate();
  const [title, setTitle] = useState(saved.shortlist.title);
  const [titleDirty, setTitleDirty] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!titleDirty) setTitle(saved.shortlist.title); }, [saved.shortlist.title, titleDirty]);
  const snapshot = saved.shortlist.trip;
  const tripDiffers = JSON.stringify(snapshot) !== JSON.stringify({ ...trip, preferences: effectivePreferences });
  return <div className="page shortlist-page">
    <div className="shortlist-heading"><div><p className="shortlist-section-label"><Bookmark size={18} aria-hidden="true" />Избранное для поездки</p><h1>Выбираем, где остановиться</h1><p className="page-intro">Сохраните варианты, запишите вопросы и вернитесь к решению вместе.</p></div><Link className="button secondary" to="/results">Добавить варианты</Link></div>
    {saved.error && <div className="shortlist-error" role="alert"><p>{saved.error}</p><button type="button" className="button secondary" disabled={saved.loading || saved.saving} onClick={() => void saved.refresh()}><RefreshCw size={17} aria-hidden="true" />Обновить подборку</button></div>}
    <p className="shortlist-storage"><Cloud size={17} aria-hidden="true" />{saved.remote ? "Сохраняется в аккаунте и доступно на ваших устройствах." : "Сохраняется в этом браузере."}{!saved.remote && <Link to="/login?next=%2Ffavorites">Войти, чтобы сохранить в аккаунте</Link>}</p>
    {saved.remote && saved.importCount > 0 && <div className="shortlist-import"><div><p>В этом браузере есть ещё {saved.importCount} сохранённых вариантов. Добавить их в ваш аккаунт?</p><p>{saved.items.length || saved.shortlist.trip ? "Добавим варианты и заметки. Название, даты и пожелания вашей подборки в аккаунте сохранятся; проверьте новые варианты для этой поездки." : "Перенесём название, сохранённые даты, пожелания и заметки из браузера."}</p></div><button className="button secondary" type="button" disabled={saved.saving || saved.loading} onClick={() => void saved.importBrowser()}>Добавить из браузера</button></div>}
    {saved.loading && !saved.ready ? <p className="loading" role="status">Загружаем вашу подборку…</p> : saved.ready && <>
      <section className="shortlist-trip" aria-label="Сохранённая поездка">
        <form onSubmit={async (event) => { event.preventDefault(); if (await saved.rename(title)) { setTitleDirty(false); setMessage("Название сохранено."); } }} className="shortlist-title-form"><label className="field"><span>Название подборки</span><input value={title} maxLength={100} required onChange={(event) => { setTitle(event.target.value); setTitleDirty(true); }} /></label>{titleDirty && <button className="button secondary" disabled={saved.saving || !title.trim()}>Сохранить</button>}</form>
        <SavedTripSummary trip={snapshot} />
        {snapshot?.locationWishes?.length ? <p className="shortlist-muted">Также сохранены пожелания о расположении: {snapshot.locationWishes.map((wish) => wish.query).join(", ")}.</p> : null}
        {snapshot?.text && <details className="shortlist-private-wish"><summary>Моё пожелание своими словами</summary><p>{snapshot.text}</p></details>}
        <div className="shortlist-trip-actions">{snapshot && <button className="button primary" type="button" onClick={() => { setTrip(snapshot); navigate("/results"); }}>Продолжить поиск по этой поездке</button>}{tripDiffers && <button className="button secondary" type="button" disabled={saved.saving} onClick={async () => { if (await saved.updateTrip({ ...trip, preferences: effectivePreferences })) setMessage("Параметры поездки обновлены. Варианты и заметки сохранены."); }}>Сохранить текущие даты и пожелания</button>}{saved.remote && saved.items.length > 0 && <button className="button secondary" type="button" disabled={saved.saving || saved.loading} onClick={() => setSharing(true)}><Share2 size={18} aria-hidden="true" />Поделиться</button>}</div>
        <p className="shortlist-muted">Сохранённые варианты не являются бронью. При продолжении поиска условия проверяются заново.</p>
      </section>
      <p role="status" className="shortlist-message">{saved.saving ? "Сохраняем…" : message}</p>
      {!saved.items.length ? <section className="v2-empty"><Heart size={36} aria-hidden="true" /><h2>Здесь соберётся ваш короткий список</h2><p>Сохраняйте понравившиеся номера сердечком. Даты и пожелания останутся рядом с ними.</p><Link className="button primary" to="/results">Выбрать варианты</Link></section> : <div className="shortlist-options">{saved.items.map((item) => <SavedOption key={item.id} item={item} />)}</div>}
    </>}
    {sharing && saved.ready && <ShareShortlist onClose={() => setSharing(false)} />}
  </div>;
}
