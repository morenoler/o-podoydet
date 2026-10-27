import type { HotelFilters } from "../../../shared/types";
import { nearbyDefinitions } from "../../../shared/nearby";

export const lodgingLabels = {
  hotel: "Отель",
  motel: "Мотель",
  guest_house: "Гостевой дом",
  hostel: "Хостел",
  apartment: "Апартаменты",
} as const;

export function CatalogFilterFields({ value = {}, onChange }: {
  value?: HotelFilters;
  onChange: (value: HotelFilters) => void;
}) {
  const types = value.lodgingTypes || [];
  return <section className="catalog-filter-fields" aria-label="Фильтры каталога">
    <label className="field">
      <span>Название или слова в источниках</span>
      <input type="search" maxLength={240} value={value.query || ""}
        placeholder="Например: Signiel, балкон, twin"
        onChange={(event) => onChange({ ...value, query: event.target.value || undefined })} />
    </label>
    <fieldset className="catalog-type-options">
      <legend>Тип размещения</legend>
      <div>{Object.entries(lodgingLabels).map(([key, label]) => {
        const type = key as keyof typeof lodgingLabels;
        return <label key={type}>
          <input type="checkbox" checked={types.includes(type)}
            onChange={(event) => onChange({ ...value, lodgingTypes: event.target.checked
              ? [...types, type] : types.filter((item) => item !== type) })} />
          <span>{label}</span>
        </label>;
      })}</div>
    </fieldset>
    <div className="catalog-number-fields">
      <label className="field">
        <span>Цена за ночь, до ₩</span>
        <input type="number" inputMode="numeric" min={1} max={100000000} step="any"
          value={value.maxPricePerNight ?? ""} placeholder="Любая"
          onChange={(event) => onChange({ ...value, maxPricePerNight: event.target.value === "" ? undefined : Number(event.target.value) })} />
      </label>
      <label className="field">
        <span>Маршрут до пляжа, до м</span>
        <input type="number" inputMode="numeric" min={1} max={100000} step="any"
          value={value.maxBeachMeters ?? ""} placeholder="Любой"
          onChange={(event) => onChange({ ...value, maxBeachMeters: event.target.value === "" ? undefined : Number(event.target.value) })} />
      </label>
    </div>
    <details className="catalog-nearby-filter">
      <summary>Что должно быть рядом{value.nearby?.length ? ` · ${value.nearby.length}` : ""}</summary>
      <p className="search-dialog-intro">Расстояние по прямой до отмеченного на карте места. «Центр» — район станции Сомён; в Пусане несколько городских центров.</p>
      <div className="catalog-nearby-options">{nearbyDefinitions.map((definition) => {
        const condition = value.nearby?.find((item) => item.kind === definition.key);
        return <div className="catalog-nearby-option" key={definition.key}>
          <label><input type="checkbox" checked={!!condition} onChange={(event) => onChange({ ...value, nearby: event.target.checked
            ? [...(value.nearby || []), { kind: definition.key, maxMeters: definition.defaultMaxMeters }]
            : value.nearby?.filter((item) => item.kind !== definition.key) })} /><span>{definition.label}</span></label>
          {condition && <label><span className="sr-only">{definition.label}: не дальше, м</span><input type="number" min={1} max={10000} step="any" value={condition.maxMeters}
            onChange={(event) => onChange({ ...value, nearby: value.nearby?.map((item) => item.kind === definition.key ? { ...item, maxMeters: Number(event.target.value) } : item) })} /><span aria-hidden="true">м</span></label>}
        </div>;
      })}</div>
    </details>
    <p className="search-dialog-intro">При ограничении цены или маршрута варианты без этих данных не показываем. Цена указана отельером; маршрут рассчитан по карте без непроверенных подходов. Поиск по словам находит упоминания, а наличие удобств нужно уточнить.</p>
  </section>;
}
