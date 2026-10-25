import type { ListingFieldsProps } from "./listingForm";
import { ListingPhotosField } from "./ListingPhotosField";

export function ListingBasicFields({
  value,
  update,
  onPhotosBusyChange,
  disabled,
}: ListingFieldsProps & {
  onPhotosBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="editor-main-section">
      <legend>Основная информация</legend>
      <label className="field">
        <span>Название объявления</span>
        <input
          required
          minLength={3}
          maxLength={160}
          value={value.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="Например, семейные апартаменты у моря"
        />
      </label>
      <div className="field-row editor-address-row">
        <label className="field">
          <span>Город</span>
          <input
            required
            minLength={2}
            maxLength={100}
            autoComplete="address-level2"
            value={value.city}
            onChange={(event) => update("city", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Адрес</span>
          <input
            required
            minLength={3}
            maxLength={250}
            autoComplete="street-address"
            value={value.address}
            onChange={(event) => update("address", event.target.value)}
            placeholder="Улица, дом"
          />
        </label>
      </div>
      <ListingPhotosField
        photos={value.photos}
        onChange={(photos) => update("photos", photos)}
        onBusyChange={onPhotosBusyChange}
        disabled={disabled}
      />
      <label className="field">
        <span>Описание</span>
        <textarea
          required
          minLength={20}
          maxLength={5000}
          rows={4}
          value={value.description}
          onChange={(event) => update("description", event.target.value)}
          placeholder="Что есть в номере, как проходит заселение и что важно знать гостю"
        />
        <small>Не менее 20 символов. Описание увидят гости.</small>
      </label>
    </fieldset>
  );
}
