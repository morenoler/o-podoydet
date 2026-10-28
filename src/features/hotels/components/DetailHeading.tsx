import { price } from "../../account/format";
export function DetailHeading({ title, address, pricePerNight, currency, demo }: {
  title: string; address: string; pricePerNight?: number; currency?: "RUB" | "KRW"; demo?: boolean;
}) {
  return <div className="figcraft-detail-heading">
    <div><h1>{title}</h1><p>{address || "Адрес пока не указан"}</p>{demo && <p>Демо · вымышленное объявление</p>}</div>
    <div className="figcraft-detail-price">
      <strong>{pricePerNight != null && pricePerNight > 0 && currency ? price(pricePerNight, currency) : "Цена по запросу"}</strong>
      <span>{pricePerNight != null && pricePerNight > 0 && currency ? "за ночь · наличие уточняйте" : "на выбранные даты"}</span>
    </div>
  </div>;
}
