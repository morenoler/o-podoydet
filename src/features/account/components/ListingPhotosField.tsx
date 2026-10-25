import { useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Link as LinkIcon,
  RotateCw,
  X,
} from "lucide-react";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { isPhotoUrl } from "../../../shared/lib/hotelPhotos";
import {
  MAX_LISTING_PHOTOS,
  useListingPhotoUploads,
} from "./useListingPhotoUploads";

export function ListingPhotosField({
  photos,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const {
    uploads,
    photosRef,
    changePhotos,
    selectFiles,
    removeUpload,
    retryUpload,
  } = useListingPhotoUploads({
    photos,
    onChange,
    onBusyChange,
    onAnnouncement: setAnnouncement,
  });
  function addUrl() {
    const value = url.trim();
    if (!isPhotoUrl(value)) {
      setErrors([
        "Укажите ссылку HTTPS на изображение или путь к фото этого сайта длиной до 2048 символов.",
      ]);
      inputRef.current?.focus();
      return;
    }
    if (photosRef.current.includes(value)) {
      setErrors(["Это фото уже добавлено."]);
      return;
    }
    if (photosRef.current.length + uploads.length >= MAX_LISTING_PHOTOS) {
      setErrors(["Можно добавить не более 6 фотографий, включая загружаемые."]);
      return;
    }
    changePhotos([...photosRef.current, value]);
    setUrl("");
    setErrors([]);
    setAdding(false);
    setAnnouncement("Фото по ссылке добавлено.");
  }
  function movePhoto(index: number, offset: number) {
    const next = [...photosRef.current];
    const destination = index + offset;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    changePhotos(next);
    setAnnouncement(
      `Фото перемещено на позицию ${destination + 1}.${destination === 0 ? " Оно станет обложкой." : ""}`,
    );
  }
  const atLimit = photos.length + uploads.length >= MAX_LISTING_PHOTOS;
  return (
    <div className="listing-photos-field">
      <span className="editor-field-label">Фотографии</span>
      <p className="listing-photo-help" id={helpId}>
        До 6 фото. JPG или PNG, не больше 8 МБ на файл. Первое фото станет
        обложкой.
      </p>
      <div className="listing-photo-add-actions">
        <button
          type="button"
          className="button primary"
          disabled={disabled || atLimit}
          aria-describedby={helpId}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={20} aria-hidden="true" />
          Загрузить с компьютера
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || atLimit}
          aria-expanded={adding}
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <LinkIcon size={18} aria-hidden="true" />
          Добавить по ссылке
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          hidden
          disabled={disabled || atLimit}
          aria-label="Выбрать фотографии жилья"
          onChange={(event) => {
            setErrors(selectFiles(Array.from(event.target.files || [])));
            event.target.value = "";
          }}
        />
      </div>
      <div className="listing-editor-photos">
        {photos.map((photo, index) => (
          <div className="listing-editor-photo" key={photo}>
            <AccommodationPhoto
              name={`Фото жилья ${index + 1}`}
              photos={[photo]}
            />
            <span className="listing-photo-position">
              {index === 0 ? "Обложка" : `Фото ${index + 1}`}
            </span>
            <div className="listing-photo-controls">
              <button
                type="button"
                aria-label={`Переместить фото ${index + 1} влево, на позицию ${index}`}
                title="Переместить влево"
                disabled={disabled || index === 0}
                onClick={() => movePhoto(index, -1)}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Переместить фото ${index + 1} вправо, на позицию ${index + 2}`}
                title="Переместить вправо"
                disabled={disabled || index === photos.length - 1}
                onClick={() => movePhoto(index, 1)}
              >
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Удалить фото ${index + 1}`}
                title="Удалить фото"
                disabled={disabled}
                onClick={() => {
                  changePhotos(
                    photosRef.current.filter(
                      (_, position) => position !== index,
                    ),
                  );
                  setAnnouncement(
                    `Фото ${index + 1} удалено из формы. Изменения применятся после сохранения.`,
                  );
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
        {uploads.map((upload) => (
          <div
            className="listing-editor-photo listing-upload-photo"
            key={upload.id}
          >
            <img
              className="accommodation-photo"
              src={upload.preview}
              alt={`Предпросмотр: ${upload.file.name}`}
            />
            <span className="listing-photo-filename">{upload.file.name}</span>
            {upload.status === "error" ? (
              <p className="listing-photo-error" role="alert">
                {upload.error}
              </p>
            ) : (
              <div className="listing-photo-progress">
                <progress
                  value={upload.progress}
                  max={100}
                  aria-label={`Загрузка ${upload.file.name}`}
                />
                <span>
                  {upload.status === "queued"
                    ? "В очереди"
                    : upload.progress === 100
                      ? "Обработка фото…"
                      : `Загрузка: ${upload.progress}%`}
                </span>
              </div>
            )}
            <div className="listing-upload-actions">
              {upload.status === "error" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled}
                  aria-label={`Повторить загрузку ${upload.file.name}`}
                  onClick={() => retryUpload(upload.id)}
                >
                  <RotateCw size={16} aria-hidden="true" /> Повторить
                </button>
              )}
              <button
                type="button"
                className="button account-text-button"
                disabled={disabled}
                aria-label={`Убрать файл ${upload.file.name}`}
                onClick={() => removeUpload(upload.id)}
              >
                <X size={16} aria-hidden="true" /> Убрать
              </button>
            </div>
          </div>
        ))}
      </div>
      {adding && (
        <div className="listing-photo-url">
          <label className="field">
            <span>Ссылка на фотографию</span>
            <input
              ref={inputRef}
              inputMode="url"
              autoComplete="url"
              maxLength={2048}
              disabled={disabled}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setErrors([]);
              }}
              placeholder="https://example.com/room.jpg"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addUrl();
                }
              }}
            />
          </label>
          <div className="account-form-actions">
            <button
              className="button secondary"
              type="button"
              disabled={disabled || atLimit}
              onClick={addUrl}
            >
              Добавить
            </button>
            <button
              className="button account-text-button"
              type="button"
              disabled={disabled}
              onClick={() => {
                setAdding(false);
                setErrors([]);
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <div className="account-form-error listing-photo-errors" role="alert">
          {errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </div>
      )}
      {atLimit && (
        <small>
          Добавлено 6 фото. Чтобы выбрать другое, удалите одно из списка.
        </small>
      )}
      {!photos.length && !uploads.length && (
        <small>Пока фото не добавлены, гости увидят заглушку.</small>
      )}
      <span
        className="listing-photo-announcement"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
    </div>
  );
}
