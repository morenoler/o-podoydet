import { features } from "./features";
import type {
  Criterion,
  Fact,
  Hotel,
  HotelMatch,
  Preference,
  Room,
  RoomMatch,
  Trip,
} from "./types";

export function evaluate(
  facts: Fact[],
  preference: Preference,
  room: Room,
  trip: Trip,
  now = new Date(),
): Criterion {
  const definition = features[preference.feature];
  if (definition.tool === "area")
    return {
      feature: preference.feature,
      required: preference.required,
      facts: [],
      status: "unknown",
      explanation: "Нужна оценка района на даты поездки через сервер",
    };
  const scoped = facts.filter(
    (f) =>
      f.feature === preference.feature &&
      !f.supersededBy &&
      (definition.scope === "hotel" ? !f.roomId : f.roomId === room.id),
  );
  const relevant = scoped.filter(
    (f) =>
      (!f.validFrom || f.validFrom <= trip.checkIn) &&
      (!f.validTo || f.validTo >= trip.checkOut),
  );
  const active = relevant.filter((f) => new Date(f.expiresAt) > now);
  const base = {
    feature: preference.feature,
    required: preference.required,
    facts: active.length ? active : relevant,
  };
  if (!active.length)
    return {
      ...base,
      status: relevant.length ? "stale" : "unknown",
      explanation: relevant.length
        ? "Сведения устарели — нужна повторная проверка"
        : "Нет достаточных сведений",
    };
  const values = new Set(active.map((f) => JSON.stringify(f.value)));
  if (values.size > 1)
    return {
      ...base,
      status: "conflict",
      explanation: "Источники противоречат друг другу — нужно уточнение",
    };
  const value = active[0].value;
  if (
    definition.evaluator === "max"
      ? typeof value !== "number" || !Number.isFinite(value) || value < 0
      : typeof value !== "boolean"
  )
    return {
      ...base,
      status: "unknown",
      explanation: "Источник не содержит проверяемого значения характеристики",
    };
  const matches =
    definition.evaluator === "max"
      ? typeof value === "number" && value <= definition.threshold!
      : value === true;
  return {
    ...base,
    status: matches ? "match" : "mismatch",
    explanation:
      preference.feature === "beach_walk"
        ? `${value} м по пешеходной сети · вход приближённый`
        : matches
          ? definition.positive
          : definition.negative,
  };
}
export function rankHotels(
  hotels: Hotel[],
  facts: Fact[],
  preferences: Preference[],
  trip: Trip,
  now = new Date(),
): HotelMatch[] {
  return hotels
    .map((hotel) => {
      const hotelFacts = facts.filter((f) => f.hotelId === hotel.id);
      const rooms: RoomMatch[] = hotel.rooms.map((room) => {
        const criteria = preferences.map((p) =>
          evaluate(hotelFacts, p, room, trip, now),
        );
        const capacity = room.capacity >= trip.adults + trip.children;
        const status: RoomMatch["status"] =
          !capacity ||
          criteria.some((c) => c.required && c.status === "mismatch")
            ? "excluded"
            : criteria.some((c) => c.required && c.status !== "match")
              ? "clarify"
              : "fits";
        return {
          room,
          criteria,
          status,
          score: criteria.reduce(
            (s, c) =>
              s +
              (c.status === "match" ? 3 : c.status === "mismatch" ? -2 : -1),
            0,
          ),
        };
      });
      const order = { fits: 0, clarify: 1, excluded: 2 };
      rooms.sort(
        (a, b) => order[a.status] - order[b.status] || b.score - a.score,
      );
      return { hotel, best: rooms[0], rooms };
    })
    .sort(
      (a, b) =>
        ({ fits: 0, clarify: 1, excluded: 2 })[a.best.status] -
          { fits: 0, clarify: 1, excluded: 2 }[b.best.status] ||
        b.best.score - a.best.score ||
        (a.hotel.route?.meters ?? Infinity) -
          (b.hotel.route?.meters ?? Infinity),
    );
}
