import { price } from "../../account/format";
import { HotelStars } from "./HotelReputation";
export function DetailHeading({ title, address, pricePerNight, currency, demo, hotelId }: {
  title: string; address: string; pricePerNight?: number; currency?: "RUB" | "KRW"; demo?: boolean; hotelId?: string;
}) {
  const knownPrice = pricePerNight != null && Number.isFinite(pricePerNight) && pricePerNight > 0 && currency;
  return <div className="figcraft-detail-heading">
    <div><div className="figcraft-detail-classification">{demo ? "Демо · вымышленное объявление" : hotelId ? <HotelStars hotelId={hotelId} /> : null}</div><h1>{title}</h1><p>{address || "Адрес пока не указан"}</p></div>
    <div className="figcraft-detail-price">
      <strong>{knownPrice ? price(pricePerNight!, currency!) : "Цена по запросу"}</strong>
      <span>{knownPrice ? "за ночь · наличие уточняйте" : "на выбранные даты"}</span>
    </div>
  </div>;
}
