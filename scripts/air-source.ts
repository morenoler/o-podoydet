/** Bounded public-source acquisition and replayable byte-exact provenance. */
import { createHash } from "node:crypto";

export const MAX_AIR_RESPONSE_BYTES = 1024 * 1024;
export interface AirSourceEnvelope {
  version: 1;
  requestUrl: string;
  fetchedAt: string;
  sha256: string;
  body: string;
}
export const sha256 = (body: string | Uint8Array) =>
  createHash("sha256").update(body).digest("hex");

export function envelope(
  body: string,
  requestUrl: string,
  fetchedAt: string,
): AirSourceEnvelope {
  if (Buffer.byteLength(body) > MAX_AIR_RESPONSE_BYTES)
    throw new Error("Air response exceeds 1 MiB");
  return { version: 1, requestUrl, fetchedAt, sha256: sha256(body), body };
}

export function parseAirSource(
  value: unknown,
  requestUrl: string,
): AirSourceEnvelope {
  if (!value || typeof value !== "object")
    throw new Error("Invalid air cache envelope");
  const data = value as AirSourceEnvelope;
  if (
    data.version !== 1 ||
    data.requestUrl !== requestUrl ||
    typeof data.body !== "string" ||
    Buffer.byteLength(data.body) > MAX_AIR_RESPONSE_BYTES ||
    data.sha256 !== sha256(data.body) ||
    typeof data.fetchedAt !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.fetchedAt) ||
    !Number.isFinite(Date.parse(data.fetchedAt))
  )
    throw new Error(
      "Air cache lacks valid URL, SHA-256 or retrieval timestamp; explicit recollection required",
    );
  JSON.parse(data.body);
  return data;
}

export async function fetchAirSource(
  requestUrl: string,
): Promise<AirSourceEnvelope> {
  const response = await fetch(requestUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (
    !response.headers.get("content-type")?.toLowerCase().includes("application/json")
  )
    throw new Error("Air source did not return JSON");
  if (!response.body) throw new Error("Air source returned no body");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AIR_RESPONSE_BYTES)
        throw new Error("Air response exceeds 1 MiB");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  // Retain a BOM rather than silently dropping bytes before computing provenance.
  // Strict JSON parsing below rejects it along with other malformed JSON.
  const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Buffer.concat(chunks),
  );
  JSON.parse(body);
  return envelope(body, requestUrl, new Date().toISOString());
}
