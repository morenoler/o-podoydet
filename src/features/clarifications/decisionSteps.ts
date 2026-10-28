import { features } from "../../../shared/features";
import type { HotelMatch, RoomMatch, Trip } from "../../../shared/types";
import { capacityNeedsClarification, criterionNeedsClarification } from "../../shared/lib/matchPresentation";

export interface DecisionStep {
  id: string;
  label: string;
  state: "match" | "unknown" | "mismatch" | "conflict";
  required: boolean;
  explanation: string;
}

/** Recognizing a few filters is not a completeness check of an arbitrary request. */
export function hasUncheckedPersonalWishes(trip: Trip, match?: HotelMatch) {
  return Boolean(trip.text.trim()) || Boolean(match?.personalWishes &&
    match.personalWishes.status !== "not_requested" && match.personalWishes.completeness === "unverified");
}

/** A decision checklist is not a new admission policy: preserve raw evidence. */
export function decisionSteps(match: HotelMatch, room: RoomMatch, trip: Trip): DecisionStep[] {
  const result: DecisionStep[] = [];
  const preferences = match.preferences || trip.preferences;
  for (const preference of preferences) {
    const criterion = room.criteria.find((item) => item.feature === preference.feature);
    const evidence = criterion?.evidenceStatus;
    result.push({
      id: preference.feature,
      label: features[preference.feature].label,
      required: preference.required,
      state: evidence === "mismatch" ? "mismatch" : evidence === "conflict" ? "conflict"
        : evidence === "match" && criterion?.status === "match" && !criterionNeedsClarification(criterion) ? "match" : "unknown",
      explanation: criterion?.sourceExplanation || criterion?.explanation || "Нет сведений для выбранного варианта.",
    });
  }
  result.push({
    id: "capacity", label: "Размещение всех гостей", required: true,
    state: room.capacityEvidenceStatus === "mismatch" ? "mismatch"
      : room.capacityEvidenceStatus === "match" && !capacityNeedsClarification(room) ? "match" : "unknown",
    explanation: room.capacityExplanation || "Уточните размещение всей вашей компании в одном варианте.",
  });
  for (const criterion of match.ownerCriteria || []) result.push({
    id: `owner:${criterion.id}`, label: criterion.label, required: criterion.required,
    state: criterion.evidenceStatus === "mismatch" ? "mismatch"
      : criterion.evidenceStatus === "match" && criterion.status === "match" ? "match" : "unknown",
    explanation: criterion.sourceExplanation || criterion.explanation,
  });
  for (const criterion of match.locationCriteria || []) result.push({
    id: `location:${criterion.id}`, label: criterion.label, required: criterion.required,
    state: criterion.evidenceStatus === "match" && criterion.status === "match" ? "match"
      : criterion.evidenceStatus === "mismatch" ? "mismatch" : "unknown",
    explanation: criterion.explanation,
  });
  if (trip.pendingLocationQuery) result.push({
    id: "pending-location", label: trip.pendingLocationQuery.query, required: trip.pendingLocationQuery.required,
    state: "unknown", explanation: "Помощник ждёт уточнения места. Это пожелание ещё не участвовало в подборе.",
  });
  if (hasUncheckedPersonalWishes(trip, match)) result.push({
    id: "personal-wishes", label: "Пожелание своими словами", required: false,
    state: "unknown", explanation: match.personalWishes?.status === "unrecognized"
      ? "В тексте не удалось распознать условия. Уточните пожелание или выберите готовые фильтры; соответствие этому тексту не проверено."
      : "Проверены только распознанные условия. Полнота проверки свободного текста не подтверждена: сопоставьте пожелание с условиями номера и дополните запрос отельеру.",
  });
  return result.sort((a, b) => Number(b.required) - Number(a.required));
}

/** Only structured, user-visible conditions enter a request, never chat history. */
export function availabilityQuestion(name: string, trip: Trip, match?: HotelMatch, room?: RoomMatch, guestCount?: number, includeTrip = true) {
  const preferences = match?.preferences || trip.preferences;
  const lines = [
    `Здравствуйте! Интересует «${name}».`,
    ...(includeTrip ? [trip.checkIn && trip.checkOut ? `Даты: ${trip.checkIn} — ${trip.checkOut}.` : "Даты поездки ещё выбираем.",
    guestCount != null && guestCount !== trip.adults + trip.children
      ? `Количество гостей: ${guestCount}. Состав по возрастам уточним отдельно. Нужен один вариант размещения.`
      : `Гости: взрослых ${trip.adults}, детей ${trip.children}. Нужен один вариант размещения.`]
      : ["Даты и количество гостей указаны в полях заявки. Нужен один вариант размещения."]),
    "Есть ли он на эти даты? Какова полная стоимость за весь срок, включая обязательные сборы? Уточните условия оплаты и отмены.",
  ];
  const conditions = preferences.filter((item) => ["host", "amenity"].includes(features[item.feature].tool));
  if (conditions.length) {
    lines.push("Пожалуйста, уточните для этого варианта:");
    for (const condition of conditions) lines.push(`• ${features[condition.feature].label}${condition.required ? " (обязательно)" : " (желательно)"}.`);
    lines.push("Удобства находятся в номере или общие? Есть ли доплата или ограничения на даты поездки?");
  }
  for (const criterion of match?.ownerCriteria || []) lines.push(`• ${criterion.label}${criterion.required ? " (обязательно)" : " (желательно)"}.`);
  if (room?.capacityEvidenceStatus !== "match") lines.push("Подтвердите, пожалуйста, вместимость для указанного состава гостей.");
  lines.push("Ответ должен относиться именно к предлагаемому варианту, а не к отелю в целом.");
  return lines.join("\n");
}

export function officialRoomUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
