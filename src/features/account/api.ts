import type {
  Booking,
  BookingStatus,
  HostListing,
  HostListingInput,
  ListingQuestion,
} from "../../../shared/account";
import { api } from "../../shared/api/client";

type PhotoUploadOptions = {
  signal: AbortSignal;
  onProgress: (progress: number) => void;
};

function uploadPhoto(file: File, { signal, onProgress }: PhotoUploadOptions) {
  return new Promise<{ url: string }>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Загрузка отменена.", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = () => {
      signal.removeEventListener("abort", abort);
      request.upload.onprogress = null;
      request.onload = null;
      request.onerror = null;
      request.ontimeout = null;
      request.onabort = null;
    };
    request.open("POST", "/api/host/photos");
    request.setRequestHeader("Content-Type", file.type);
    request.timeout = 120000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      finish();
      let data: { url?: string; error?: string } = {};
      try {
        const parsed: unknown = JSON.parse(request.responseText);
        if (parsed && typeof parsed === "object") {
          const response = parsed as Record<string, unknown>;
          data = {
            url: typeof response.url === "string" ? response.url : undefined,
            error:
              typeof response.error === "string" ? response.error : undefined,
          };
        }
      } catch {
        /* A proxy may return a non-JSON error response. */
      }
      if (request.status >= 200 && request.status < 300 && data.url) {
        resolve({ url: data.url });
        return;
      }
      const fallback =
        request.status === 413
          ? "Файл слишком большой. Выберите JPG или PNG размером до 8 МБ."
          : request.status === 401
            ? "Сессия закончилась. Войдите снова и повторите загрузку."
            : request.status === 415
              ? "Поддерживаются только изображения JPG и PNG."
              : "Не удалось загрузить фото. Попробуйте ещё раз.";
      reject(new Error(data.error || fallback));
    };
    request.onerror = () => {
      finish();
      reject(
        new Error(
          "Нет связи с сервером. Проверьте подключение и повторите загрузку.",
        ),
      );
    };
    request.ontimeout = () => {
      finish();
      reject(
        new Error("Загрузка заняла слишком много времени. Попробуйте ещё раз."),
      );
    };
    request.onabort = () => {
      finish();
      reject(new DOMException("Загрузка отменена.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      request.send(file);
    } catch (error) {
      finish();
      reject(
        error instanceof Error
          ? error
          : new Error("Не удалось начать загрузку фото."),
      );
    }
  });
}

export const accountApi = {
  uploadPhoto,
  saveListing: (input: HostListingInput, id?: string) =>
    api<HostListing>(id ? `/host/listings/${id}` : "/host/listings", input),
  answer: (id: string, answer: string) =>
    api<ListingQuestion>(`/host/questions/${id}/answer`, { answer }),
  setBookingStatus: (id: string, status: BookingStatus) =>
    api<Booking>(`/host/bookings/${id}/status`, { status }),
  replyToBooking: (id: string, message: string) =>
    api<Booking>(`/host/bookings/${encodeURIComponent(id)}/reply`, { message }),
  cancelBooking: (id: string) =>
    api<Booking>(`/account/bookings/${id}/cancel`, {}),
};
