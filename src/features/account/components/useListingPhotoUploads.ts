import { useEffect, useRef, useState } from "react";
import { isPhotoUrl } from "../../../shared/lib/hotelPhotos";
import { accountApi } from "../api";

export const MAX_LISTING_PHOTOS = 6;
const maxFileBytes = 8 * 1024 * 1024;
type Upload = {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: "queued" | "uploading" | "error";
  error?: string;
};

export function useListingPhotoUploads({
  photos,
  onChange,
  onBusyChange,
  onAnnouncement,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusyChange: (busy: boolean) => void;
  onAnnouncement: (message: string) => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadsRef = useRef<Upload[]>([]);
  const photosRef = useRef(photos);
  const callbacksRef = useRef({ onChange, onBusyChange, onAnnouncement });
  const controllersRef = useRef(new Map<string, AbortController>());
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  photosRef.current = photos;
  callbacksRef.current = { onChange, onBusyChange, onAnnouncement };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      uploadsRef.current.forEach((upload) =>
        URL.revokeObjectURL(upload.preview),
      );
      uploadsRef.current = [];
      callbacksRef.current.onBusyChange(false);
    };
  }, []);

  function changePhotos(next: string[]) {
    photosRef.current = next;
    callbacksRef.current.onChange(next);
  }
  function changeUploads(next: Upload[]) {
    const wasBusy = uploadsRef.current.length > 0;
    const isBusy = next.length > 0;
    uploadsRef.current = next;
    setUploads(next);
    // Failed previews remain unresolved until retried or explicitly removed.
    if (wasBusy !== isBusy) callbacksRef.current.onBusyChange(isBusy);
  }
  function updateUpload(id: string, patch: Partial<Upload>) {
    if (!uploadsRef.current.some((upload) => upload.id === id)) return;
    changeUploads(
      uploadsRef.current.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload,
      ),
    );
  }
  function removeUpload(id: string) {
    const upload = uploadsRef.current.find((item) => item.id === id);
    if (!upload) return;
    changeUploads(uploadsRef.current.filter((item) => item.id !== id));
    controllersRef.current.get(id)?.abort();
    URL.revokeObjectURL(upload.preview);
  }
  async function processUploads() {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (mountedRef.current) {
        const upload = uploadsRef.current.find(
          (item) => item.status === "queued",
        );
        if (!upload) break;
        const controller = new AbortController();
        controllersRef.current.set(upload.id, controller);
        updateUpload(upload.id, { status: "uploading", progress: 0 });
        try {
          const result = await accountApi.uploadPhoto(upload.file, {
            signal: controller.signal,
            onProgress: (progress) => {
              if (mountedRef.current && !controller.signal.aborted)
                updateUpload(upload.id, { progress });
            },
          });
          if (!mountedRef.current || controller.signal.aborted) continue;
          if (!isPhotoUrl(result.url))
            throw new Error(
              "Сервер вернул некорректную ссылку на фото. Повторите загрузку.",
            );
          changePhotos([...photosRef.current, result.url]);
          changeUploads(
            uploadsRef.current.filter((item) => item.id !== upload.id),
          );
          URL.revokeObjectURL(upload.preview);
          callbacksRef.current.onAnnouncement(
            `Фото «${upload.file.name}» загружено.`,
          );
        } catch (error) {
          if (!mountedRef.current || controller.signal.aborted) continue;
          updateUpload(upload.id, {
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Не удалось загрузить фото. Попробуйте ещё раз.",
          });
        } finally {
          controllersRef.current.delete(upload.id);
        }
      }
    } finally {
      processingRef.current = false;
    }
  }
  function selectFiles(files: File[]) {
    const issues: string[] = [];
    const accepted: Upload[] = [];
    const available =
      MAX_LISTING_PHOTOS - photosRef.current.length - uploadsRef.current.length;
    for (const file of files) {
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        issues.push(
          `«${file.name}»: поддерживаются только JPG и PNG, до 8 МБ на файл.`,
        );
      } else if (!file.size || file.size > maxFileBytes) {
        issues.push(
          `«${file.name}»: ${file.size ? "размер больше 8 МБ" : "файл пустой"}. Выберите JPG или PNG размером до 8 МБ.`,
        );
      } else if (accepted.length >= available) {
        issues.push(
          `«${file.name}»: достигнут предел 6 фотографий. Удалите лишнее фото и добавьте файл снова.`,
        );
      } else {
        accepted.push({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          progress: 0,
          status: "queued",
        });
      }
    }
    if (accepted.length) {
      changeUploads([...uploadsRef.current, ...accepted]);
      void processUploads();
    }
    return issues;
  }
  function retryUpload(id: string) {
    if (
      !uploadsRef.current.some(
        (upload) => upload.id === id && upload.status === "error",
      )
    )
      return;
    updateUpload(id, { status: "queued", error: undefined, progress: 0 });
    void processUploads();
  }
  return {
    uploads,
    photosRef,
    changePhotos,
    selectFiles,
    removeUpload,
    retryUpload,
  };
}
