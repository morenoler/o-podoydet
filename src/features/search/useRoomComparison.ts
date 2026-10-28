import { useEffect, useState } from "react";
import type { HotelMatch, SearchResult, Trip } from "../../../shared/types";
import { api } from "../../shared/api/client";
import { canSearch } from "./searchTrip";
import type { RoomSearchItem } from "./roomResults";
import { comparisonMatchForRoom, comparisonSelection, currentComparisonEntries, type ComparisonSelection } from "./comparison";

export function useRoomComparison(scope: string, trip: Trip, searchKey: string, result: SearchResult | null, error: string) {
  const [saved, setSaved] = useState<{ scope: string; items: ComparisonSelection[] }>({ scope, items: [] });
  const selections = saved.scope === scope ? saved.items : [];
  const [evaluations, setEvaluations] = useState<{ key: string; matches: Record<string, HotelMatch>; errors: Record<string, string> } | null>(null);
  const candidates = result ? [...result.roomRecommendations, ...result.roomAlternatives] : [];
  const selectionKey = JSON.stringify(selections.map((selection) => selection.id));

  useEffect(() => {
    if (!result || !canSearch(trip)) return;
    let active = true;
    const missing = selections.filter((selection) => !candidates.some((item) => item.id === selection.id));
    const hotelRequests = new Map<string, Promise<HotelMatch>>();
    const matches: Record<string, HotelMatch> = {};
    const errors: Record<string, string> = {};
    void Promise.all(missing.map(async (selection) => {
      try {
        if (!hotelRequests.has(selection.hotelId)) hotelRequests.set(selection.hotelId, api<HotelMatch>(`/hotels/${encodeURIComponent(selection.hotelId)}/evaluate`, trip));
        const response = await hotelRequests.get(selection.hotelId)!;
        const match = comparisonMatchForRoom(response, selection.roomId);
        if (match) matches[selection.id] = match;
        else errors[selection.id] = "Эта категория больше не доступна для проверки. Откройте отель, чтобы выбрать другую.";
      } catch {
        errors[selection.id] = "Не удалось перепроверить этот номер. Повторите поиск или откройте его подробности.";
      }
    })).then(() => {
      if (active) setEvaluations({ key: searchKey, matches, errors });
    });
    return () => { active = false; };
  }, [searchKey, selectionKey, result]);

  const pending = !canSearch(trip) ? "Выберите даты и гостей, чтобы проверить этот номер для вашей поездки."
    : error ? "Поиск не обновился. Прежняя оценка скрыта; повторите поиск для проверки."
      : !result ? "Перепроверяем по новым условиям…" : undefined;
  const entries = currentComparisonEntries(selections, candidates, evaluations, searchKey, pending);
  function toggle(item: RoomSearchItem) {
    setSaved((previous) => {
      const items = previous.scope === scope ? previous.items : [];
      return { scope, items: items.some((selection) => selection.id === item.id)
        ? items.filter((selection) => selection.id !== item.id)
        : items.length < 3 ? [...items, comparisonSelection(item)] : items };
    });
  }
  return { selections, entries, toggle, clear: () => setSaved({ scope, items: [] }), remove: (id: string) => setSaved({ scope, items: selections.filter((selection) => selection.id !== id) }) };
}
