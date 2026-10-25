import { useRef, useState, type FormEvent } from "react";
import type { HostListing } from "../../../../shared/account";
import { accountApi } from "../api";
import { ListingSearchProfileFields } from "./ListingSearchProfileFields";
import { ListingBasicFields } from "./ListingBasicFields";
import { ListingRoomFields } from "./ListingRoomFields";
import { ListingPreview } from "./ListingPreview";
import { editableListing, type EditableListing } from "./listingForm";
import "../editor-v2.css";

const suggestedAmenities = [
  "Wi-Fi",
  "Кондиционер",
  "Кухня",
  "Парковка",
  "Лифт",
  "Стиральная машина",
  "Можно с детьми",
  "Можно с питомцами",
];

export function ListingEditor({
  listing,
  onSaved,
  onCancel,
}: {
  listing?: HostListing;
  onSaved: (listing: HostListing) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EditableListing>(() =>
    editableListing(listing),
  );
  const [busy, setBusy] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  function update<K extends keyof EditableListing>(
    key: K,
    value: EditableListing[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  function toggleAmenity(value: string) {
    update(
      "amenities",
      form.amenities.includes(value)
        ? form.amenities.filter((item) => item !== value)
        : [...form.amenities, value],
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || photosBusy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await accountApi.saveListing(
          {
            ...form,
            title: form.title.trim(),
            description: form.description.trim(),
            city: form.city.trim(),
            address: form.address.trim(),
            roomType: form.roomType.trim(),
          },
          listing?.id,
        ),
      );
    } catch (error) {
      setError((error as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    if (
      (photosBusy ||
        JSON.stringify(form) !== JSON.stringify(editableListing(listing))) &&
      !window.confirm("Закрыть форму? Несохранённые изменения будут потеряны.")
    )
      return;
    onCancel();
  }
  return (
    <div className="account-editor-layout">
      <form
        className="account-panel account-form listing-editor listing-editor-v2"
        onSubmit={submit}
      >
        {error && (
          <div
            className="account-form-error"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            {error}
          </div>
        )}
        <ListingBasicFields
          value={form}
          update={update}
          onPhotosBusyChange={setPhotosBusy}
          disabled={busy}
        />
        <ListingRoomFields value={form} update={update} />
        <fieldset className="editor-amenities-section">
          <legend>Удобства</legend>
          <div className="listing-amenities-field">
            <div className="listing-amenity-options">
              {suggestedAmenities.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={form.amenities.includes(value)}
                    onChange={() => toggleAmenity(value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>
        <ListingSearchProfileFields
          value={form.searchProfile}
          onChange={(profile) => update("searchProfile", profile)}
        />
        <fieldset className="listing-publication">
          <legend>Публикация</legend>
          <label>
            <input
              type="radio"
              name="listing-status"
              value="draft"
              checked={form.status === "draft"}
              onChange={() => update("status", "draft")}
            />
            <span>
              <strong>Сохранить как черновик</strong>
              <small>
                Объявление видно только вам. Вернуться к нему можно позже.
              </small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="listing-status"
              value="published"
              checked={form.status === "published"}
              onChange={() => update("status", "published")}
            />
            <span>
              <strong>Опубликовать для гостей</strong>
              <small>
                Гости смогут задать вопрос и отправить заявку на проживание.
              </small>
            </span>
          </label>
        </fieldset>
        <div className="account-form-actions editor-save-actions">
          {photosBusy && (
            <p className="editor-photo-pending-hint" role="status">
              Дождитесь загрузки фотографий. Если появилась ошибка, повторите
              попытку или уберите файл перед сохранением.
            </p>
          )}
          <button className="button primary" disabled={busy || photosBusy}>
            {busy
              ? "Сохраняем…"
              : photosBusy
                ? "Фото ещё не готовы"
                : form.status === "published"
                  ? listing?.status === "published"
                    ? "Сохранить изменения"
                    : "Опубликовать объявление"
                  : "Сохранить черновик"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={cancel}
          >
            Отменить
          </button>
        </div>
      </form>
      <ListingPreview value={form} />
    </div>
  );
}
