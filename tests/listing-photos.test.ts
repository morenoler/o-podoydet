import { test } from "node:test";
import assert from "node:assert/strict";
import { isPhotoUrl, accommodationPhotos } from "../src/shared/lib/hotelPhotos";
import { accountApi } from "../src/features/account/api";

const uploaded = "/uploads/listings/9c428f66-f7b5-49b6-8198-b717be9e209a.jpg";

test("listing photo URLs accept returned uploads, catalog assets and HTTPS images", () => {
  for (const url of [
    uploaded,
    uploaded.replace(".jpg", ".png"),
    "/images/hotels/room_2.jpg",
    "https://photos.example.com/room.jpg?size=large",
  ])
    assert.equal(isPhotoUrl(url), true, url);
  assert.deepEqual(accommodationPhotos(undefined, [uploaded]), [uploaded]);
  assert.deepEqual(accommodationPhotos("account-listing:empty", []), []);
});

test("listing photo URLs reject traversal, unsupported uploads and executable schemes", () => {
  for (const url of [
    uploaded + "?download=1",
    uploaded + "#preview",
    uploaded.replace(".jpg", ".svg"),
    uploaded.replace(".jpg", ".jpeg"),
    uploaded.toUpperCase(),
    "/uploads/listings/not-a-uuid.png",
    "/uploads/listings/../room.png",
    "/uploads/listings/%2e%2e/room.png",
    "/images/../private.png",
    "/images/./room.png",
    "/images/%2e%2e/private.png",
    "/images//room.png",
    "/images/room/",
    "/images/room.png?x=1",
    "//example.com/room.png",
    "http://example.com/room.png",
    "https://user:password@example.com/room.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///tmp/room.png",
    "https://example.com/" + "a".repeat(2048),
    null,
    {},
  ])
    assert.equal(isPhotoUrl(url), false, String(url));
  assert.deepEqual(
    accommodationPhotos(undefined, ["javascript:alert(1)", uploaded]),
    [uploaded],
  );
});

type Progress = { lengthComputable: boolean; loaded: number; total: number };
function mockTransport(
  after: (cleanup: () => void) => void,
  sendError?: Error,
) {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "XMLHttpRequest",
  );
  const requests: Transport[] = [];
  class Transport {
    upload: { onprogress: ((event: Progress) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers = new Map<string, string>();
    method = "";
    path = "";
    body?: File;
    status = 0;
    responseText = "";
    timeout = 0;
    abortCount = 0;
    constructor() {
      requests.push(this);
    }
    open(method: string, path: string) {
      this.method = method;
      this.path = path;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    send(body: File) {
      if (sendError) throw sendError;
      this.body = body;
    }
    abort() {
      this.abortCount++;
      this.onabort?.();
    }
    respond(status: number, body: unknown, raw = false) {
      this.status = status;
      this.responseText = raw ? String(body) : JSON.stringify(body);
      this.onload?.();
    }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: Transport,
  });
  after(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  });
  return requests;
}
function photo() {
  return new File([new Uint8Array([137, 80, 78, 71])], "room.png", {
    type: "image/png",
  });
}

test("photo upload sends the original binary file and exposes actual transfer progress", async (t) => {
  const requests = mockTransport((cleanup) => t.after(cleanup));
  const controller = new AbortController();
  const progress: number[] = [];
  const file = photo();
  const promise = accountApi.uploadPhoto(file, {
    signal: controller.signal,
    onProgress: (value) => progress.push(value),
  });
  const request = requests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/api/host/photos");
  assert.equal(request.headers.get("Content-Type"), file.type);
  assert.equal(request.body, file);
  request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 });
  request.upload.onprogress?.({ lengthComputable: false, loaded: 4, total: 0 });
  request.respond(201, { url: uploaded });
  assert.deepEqual(await promise, { url: uploaded });
  assert.deepEqual(progress, [40]);
  controller.abort();
  assert.equal(
    request.abortCount,
    0,
    "a completed upload must detach its abort listener",
  );
  assert.equal(
    request.upload.onprogress,
    null,
    "completed requests cannot report stale progress",
  );
});

test("photo upload preserves server errors and handles non-JSON or malformed responses", async (t) => {
  const requests = mockTransport((cleanup) => t.after(cleanup));
  for (const [status, body, raw, expected] of [
    [413, "<html>Payload Too Large</html>", true, /8 МБ/],
    [
      415,
      { error: "Формат содержимого не совпадает." },
      false,
      /Формат содержимого не совпадает/,
    ],
    [
      429,
      { error: "Сервер занят. Повторите загрузку." },
      false,
      /Сервер занят/,
    ],
    [401, null, false, /Войдите снова/],
    [201, { url: 123 }, false, /Не удалось загрузить фото/],
    [200, {}, false, /Не удалось загрузить фото/],
  ] as const) {
    const promise = accountApi.uploadPhoto(photo(), {
      signal: new AbortController().signal,
      onProgress() {},
    });
    requests.at(-1)!.respond(status, body, raw);
    await assert.rejects(promise, expected);
  }
});

test("photo upload reports network failures and timeouts without leaving cancellation listeners", async (t) => {
  const requests = mockTransport((cleanup) => t.after(cleanup));
  for (const event of ["onerror", "ontimeout"] as const) {
    const controller = new AbortController();
    const promise = accountApi.uploadPhoto(photo(), {
      signal: controller.signal,
      onProgress() {},
    });
    const request = requests.at(-1)!;
    request[event]?.();
    await assert.rejects(
      promise,
      event === "onerror" ? /Проверьте подключение/ : /слишком много времени/,
    );
    controller.abort();
    assert.equal(request.abortCount, 0);
  }
});

test("photo upload cancellation prevents late completion and permits a separate retry", async (t) => {
  const requests = mockTransport((cleanup) => t.after(cleanup));
  const controller = new AbortController();
  const promise = accountApi.uploadPhoto(photo(), {
    signal: controller.signal,
    onProgress() {},
  });
  const cancelled = requests[0];
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  cancelled.respond(201, { url: uploaded });
  assert.equal(cancelled.onload, null);
  const retry = accountApi.uploadPhoto(photo(), {
    signal: new AbortController().signal,
    onProgress() {},
  });
  requests[1].respond(201, { url: uploaded });
  assert.deepEqual(await retry, { url: uploaded });
});

test("an already aborted photo upload never opens a request", async (t) => {
  const requests = mockTransport((cleanup) => t.after(cleanup));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    accountApi.uploadPhoto(photo(), {
      signal: controller.signal,
      onProgress() {},
    }),
    { name: "AbortError" },
  );
  assert.equal(requests.length, 0);
});

test("a synchronous transport failure cleans up its abort listener", async (t) => {
  const requests = mockTransport(
    (cleanup) => t.after(cleanup),
    new Error("Transport unavailable"),
  );
  const controller = new AbortController();
  await assert.rejects(
    accountApi.uploadPhoto(photo(), {
      signal: controller.signal,
      onProgress() {},
    }),
    /Transport unavailable/,
  );
  controller.abort();
  assert.equal(requests[0].abortCount, 0);
});
