import { decideCapacity, decideCriterion } from "./domain/binaryDecisionPolicy";
import { decideAdmission } from "./domain/admissionPolicy";
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

function sourced(
  value: { sourceUrl?: string; obtainedAt?: string; quote?: string },
  now: Date,
) {
  try {
    const url = new URL(value.sourceUrl || "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !!value.quote?.trim() &&
      Date.parse(value.obtainedAt || "") <= +now
    );
  } catch {
    return false;
  }
}
function verifiedRoom(room: Room, now: Date) {
  const obtained = Date.parse(room.obtainedAt || "");
  return (
    room.demo === false &&
    room.evidenceStatus === "verified" &&
    sourced(room, now) &&
    Number.isFinite(obtained) &&
    obtained <= +now &&
    +now - obtained <= 30 * 86400000
  );
}

/** A failure on any trip day matters; a positive statement must cover the entire stay. */
function appliesToTrip(fact: Fact, trip: Trip, threshold?: number) {
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const from = fact.validFrom, to = fact.validTo;
  try {
    if ((from != null && !date(from)) || (to != null && !date(to)) || (from && to && from > to)) return false;
  } catch { return false; }
  const negative = threshold === undefined ? fact.value === false
    : typeof fact.value === "number" && Number.isFinite(fact.value) && fact.value > threshold;
  return negative
    ? (!from || from <= trip.checkOut) && (!to || to >= trip.checkIn)
    : (!from || from <= trip.checkIn) && (!to || to >= trip.checkOut);
}

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
      f.demo === false &&
      ["official", "geo"].includes(f.method) &&
      sourced(f, now) &&
      f.feature === preference.feature &&
      !f.supersededBy &&
      (definition.scope === "hotel" ? !f.roomId : f.roomId === room.id),
  );
  const relevant = scoped.filter((f) => appliesToTrip(f, trip,
    definition.evaluator === "max" ? definition.threshold : undefined));
  const active = relevant.filter((f) => new Date(f.expiresAt) > now);
  const base = {
    feature: preference.feature,
    required: preference.required,
    facts: active.length ? active : relevant,
  };
  if (definition.scope === "room" && !verifiedRoom(room, now))
    return {
      ...base,
      facts: [],
      status: "unknown",
      explanation: "Категория номера не подтверждена официальным источником",
    };
  if (!active.length)
    return {
      ...base,
      status: relevant.length ? "stale" : "unknown",
      explanation: relevant.length
        ? "Сведения устарели — нужна повторная проверка"
        : "Нет достаточных сведений",
    };
  const known = active.filter((f) => f.value !== null);
  if (!known.length)
    return {
      ...base,
      status: "unknown",
      explanation: active.map((f) => f.quote).join(" "),
    };
  const values = new Set(known.map((f) => JSON.stringify(f.value)));
  if (values.size > 1)
    return {
      ...base,
      status: "conflict",
      explanation: "Источники содержат несовместимые значения",
    };
  const value = known[0].value;
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
      const verifiedRooms = hotel.rooms.filter((room) =>
        verifiedRoom(room, now),
      );
      const visibleRooms: Room[] = verifiedRooms.length
        ? verifiedRooms
        : [
            {
              id: `${hotel.id}-unverified`,
              name: "Категория номера не подтверждена",
              capacity: null,
              demo: false,
              evidenceStatus: "unknown",
            },
          ];
      const rooms: RoomMatch[] = visibleRooms.map((room) => {
        const criteria = preferences.map((p) =>
          decideCriterion(evaluate(hotelFacts, p, room, trip, now), hotel),
        );
        const capacity = decideCapacity(hotel, room, trip, now);
        return {
          room,
          criteria,
          ...decideAdmission(capacity, criteria, trip),
          ...capacity,
          score: criteria.reduce(
            (s, c) =>
              s +
              (c.status === "match"
                ? 3
                : c.feature === "low_noise" && c.riskLevel === "high"
                  ? -3
                  : -2),
            0,
          ),
        };
      });
      const order = { fits: 0, excluded: 1 };
      rooms.sort(
        (a, b) => order[a.status] - order[b.status] ||
          Number(!!a.provisional) - Number(!!b.provisional) || b.score - a.score,
      );
      return { hotel, best: rooms[0], rooms };
    })
    .sort(
      (a, b) =>
        ({ fits: 0, excluded: 1 })[a.best.status] -
          { fits: 0, excluded: 1 }[b.best.status] ||
        Number(!!a.best.provisional) - Number(!!b.best.provisional) ||
        b.best.score - a.best.score ||
        (a.hotel.route?.meters ?? Infinity) -
          (b.hotel.route?.meters ?? Infinity),
    );
}
