import { useEffect, useState } from "react";
import { api } from "../../shared/api/client";
import type { Surroundings } from "./placePresentation";

const requests = new Map<string, { at: number; promise: Promise<Surroundings> }>();
function loadSurroundings(hotelId: string) {
  const cached = requests.get(hotelId);
  if (cached && Date.now() - cached.at < 300_000) return cached.promise;
  if (requests.size >= 40) requests.delete(requests.keys().next().value!);
  const promise = api<Surroundings>(`/hotels/${encodeURIComponent(hotelId)}/places`).catch(error => { requests.delete(hotelId); throw error; });
  requests.set(hotelId, { at: Date.now(), promise });
  return promise;
}
export function useSurroundings(hotelId: string) {
  const [response, setResponse] = useState<{ id: string; data: Surroundings | null; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    loadSurroundings(hotelId).then(data => { if (active) setResponse({ id: hotelId, data, error: false }); })
      .catch(() => { if (active) setResponse({ id: hotelId, data: null, error: true }); });
    return () => { active = false; };
  }, [hotelId]);
  return response?.id === hotelId ? response : { id: hotelId, data: null, error: false };
}
