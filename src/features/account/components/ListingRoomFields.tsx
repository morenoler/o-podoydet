import { useId } from "react";
import { Check, Info } from "lucide-react";
import type { WindowDirection } from "../../../../shared/account";
import { directionLabels } from "../format";
import type { ListingFieldsProps } from "./listingForm";
import { currencySymbol, listingCurrency } from "../../../../shared/regions";
import { ListingSleepingFields } from "./ListingSleepingFields";

const directions = Object.keys(directionLabels) as WindowDirection[];
export function ListingRoomFields({ value, update, disabled = false }: ListingFieldsProps & { disabled?: boolean }) {
  const id = useId();
  function toggle(direction: WindowDirection) {
    update(
      "windowDirections",
      value.windowDirections.includes(direction)
        ? value.windowDirections.filter((item) => item !== direction)
        : [...value.windowDirections, direction],
    );
  }
  return (
    <fieldset className="editor-room-section" disabled={disabled}>
      <legend>
        <span className="editor-desktop-title">Номер и размещение</span>
        <span className="editor-mobile-title">Параметры номера</span>
      </legend>
      <p className="editor-mobile-subtitle">
        {value.title || "Новое объявление"}
      </p>
      <div className="editor-room-grid">
        <label className="field editor-room-type">
          <span>Тип номера</span>
          <input
            required
            minLength={2}
            maxLength={100}
            value={value.roomType}
            onChange={(event) => update("roomType", event.target.value)}
            placeholder="Например, двухместный Deluxe"
          />
        </label>
        <label className="field editor-capacity">
          <span>Максимум гостей</span>
          <input
            type="number"
            required
            min={1}
            max={20}
            step={1}
            value={value.capacity || ""}
            onChange={(event) => update("capacity", Number(event.target.value))}
          />
        </label>
        <label className="field editor-floor">
          <span>Этаж номера</span>
          <input
            type="number"
            min={-3}
            max={200}
            step={1}
            value={value.floor ?? ""}
            onChange={(event) =>
              update(
                "floor",
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
            placeholder="Не указано"
          />
        </label>
        <div className="field editor-price">
          <label htmlFor={`${id}-price`}>Стоимость за ночь, {currencySymbol(value.currency)}</label>
          <input
            id={`${id}-price`}
            type="number"
            required
            min={1}
            max={100000000}
            step={1}
            value={value.pricePerNight || ""}
            onChange={(event) =>
              update("pricePerNight", Number(event.target.value))
            }
          />
          {!value.pricePerNight && <small role="status">Введите стоимость в {value.currency === "RUB" ? "рублях" : "вонах"}. При смене валюты прежняя сумма сбрасывается.</small>}
          {value.currency !== listingCurrency(value.city) && <small>
            Сохранена цена в {value.currency === "RUB" ? "рублях" : "вонах"}.
            {" "}<button className="text-link" type="button" onClick={() => update("currency", listingCurrency(value.city))}>
              Указать цену в {listingCurrency(value.city) === "RUB" ? "рублях" : "вонах"}
            </button>. Потребуется ввести сумму заново.
          </small>}
        </div>
        <div
          className="editor-window-directions"
          role="group"
          aria-labelledby={`${id}-label`}
        >
          <h3 id={`${id}-label`}>Куда выходят окна</h3>
          <p>Выберите одну или несколько сторон света.</p>
          <div className="editor-window-options">
            {directions.map((direction) => (
              <label
                key={direction}
                className={
                  value.windowDirections.includes(direction)
                    ? "editor-window-option selected"
                    : "editor-window-option"
                }
              >
                <input
                  type="checkbox"
                  checked={value.windowDirections.includes(direction)}
                  onChange={() => toggle(direction)}
                />
                <Check size={19} aria-hidden="true" />
                <span>{directionLabels[direction]}</span>
              </label>
            ))}
          </div>
          <p className="editor-missing-hint">
            Без выбора в объявлении будет показано «Не указано».
          </p>
        </div>
      </div>
      <ListingSleepingFields value={value} update={update} disabled={disabled} />
      <div className="editor-mobile-room-help">
        <Info size={22} aria-hidden="true" />
        <p>
          Этаж и стороны света увидят гости. Укажите данные именно о
          предлагаемом номере.
        </p>
      </div>
    </fieldset>
  );
}
