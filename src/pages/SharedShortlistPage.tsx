import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Link2 } from "lucide-react";
import type { SharedShortlist } from "../../shared/shortlist";
import { shortlistApi } from "../features/favorites/shortlistApi";
import { AccommodationPhoto } from "../shared/ui/AccommodationPhoto";
import { SavedTripSummary } from "./FavoritesPage";
import "../features/favorites/shortlist.css";

export function SharedShortlistPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<SharedShortlist | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    shortlistApi.shared(token).then((value) => { if (active) setData(value); }).catch((failure) => { if (active) setError((failure as Error).message); });
    return () => { active = false; };
  }, [token]);
  return <div className="page shortlist-page">
    {error ? <section className="v2-empty"><h1>Подборка недоступна</h1><p role="alert">{error}</p><Link className="button primary" to="/">Найти варианты для своей поездки</Link></section> : !data ? <p className="loading" role="status">Загружаем подборку…</p> : <>
      <div className="shortlist-heading"><div><p className="shortlist-section-label"><Link2 size={18} aria-hidden="true" />С вами поделились подборкой</p><h1>{data.title}</h1><p className="page-intro">Копия от {new Date(data.sharedAt).toLocaleDateString("ru-RU")}. Только для просмотра.</p></div><Link className="button secondary" to="/results">Начать свой поиск</Link></div>
      <section className="shortlist-trip"><SavedTripSummary trip={data.trip} /><p className="shortlist-muted">Цена, наличие и соответствие пожеланиям не подтверждаются сохранением в подборку. Смотрите актуальные сведения в каждом варианте.</p></section>
      <div className="shortlist-options shortlist-shared-options">{data.items.map((item) => <article className="shortlist-option" key={item.id}><div className="shortlist-option-photo"><AccommodationPhoto name={item.name} hotelId={item.hotelId} photos={item.photos} /></div><div className="shortlist-option-body"><h2>{item.name}</h2>{item.address && <p className="shortlist-muted">{item.address}</p>}<Link className="button primary" to={item.path}>Посмотреть вариант</Link></div></article>)}</div>
    </>}
  </div>;
}
