import { features } from "../../../shared/features";
import type {
  CriterionDecision,
  Hotel,
  Preference,
  RoomMatch,
} from "../../../shared/types";

export const ownerClarifiableFeatures = [
  "courtyard",
  "step_free_access",
  "family",
] as const;
export type OwnerClarifiableFeature = (typeof ownerClarifiableFeatures)[number];

export function ownerCanClarify(
  feature: string,
): feature is OwnerClarifiableFeature {
  return ownerClarifiableFeatures.some((supported) => supported === feature);
}

export function clarificationItems(room: RoomMatch, preferences: Preference[]) {
  const selected = new Map(
    preferences.map((preference) => [preference.feature, preference]),
  );
  return room.criteria
    .filter((criterion) => selected.has(criterion.feature))
    .filter(
      (criterion) => criterion.evidenceStatus !== "match" || criterion.assumed,
    )
    .map((criterion) => ({
      ...criterion,
      required: selected.get(criterion.feature)!.required,
    }))
    .sort((first, second) => Number(second.required) - Number(first.required));
}

export function clarificationState(criterion: CriterionDecision) {
  switch (criterion.evidenceStatus) {
    case "mismatch":
      return "Есть несоответствие";
    case "conflict":
      return "Сведения противоречат друг другу";
    case "stale":
      return "Сведения пора обновить";
    default:
      return "Пока нет подтверждения";
  }
}

export function catalogQuestion(
  hotel: Pick<Hotel, "name">,
  room: RoomMatch["room"],
  criterion: CriterionDecision,
) {
  const subject =
    room.scope === "room_category" && room.evidenceStatus === "verified"
      ? `Интересует категория «${room.name}» в «${hotel.name}».`
      : `Интересует размещение в «${hotel.name}». Конкретная категория номера пока не выбрана.`;
  return `${subject}\n${features[criterion.feature].question}\nУточните, пожалуйста, относится ли ответ ко всем номерам этой категории или только к отдельным вариантам. Если есть ограничения, перечислите их.`;
}

export function independentCheck(feature: CriterionDecision["feature"]) {
  switch (feature) {
    case "area_safety":
      return "Нужна официальная статистика с сопоставимыми периодом, территорией и числом жителей. Ответ отельера не подтверждает безопасность района.";
    case "clean_air":
      return "Нужен прогноз качества воздуха, покрывающий все даты поездки. Текущее значение и впечатление владельца не заменяют прогноз.";
    case "low_noise":
      return "Нужны данные об окружающих дорогах, трафике и событиях на даты поездки. Для тишины внутри номера нужна отдельная проверка; сторона окон её не гарантирует.";
    case "step_free_route":
      return "Нужно проверить весь путь от входа к пляжу, переходы, ступени и доступные обходы. Отсутствие лестницы на карте не доказывает доступность.";
    case "beach_walk":
      return "Нужен пешеходный маршрут от реального входа до доступного подхода к пляжу. Расстояние по прямой и точка центра здания не заменяют маршрут.";
    default:
      return "Уточните условия именно выбранного варианта размещения.";
  }
}

export function withClarificationPreference(
  trip: import("../../../shared/types").Trip,
  feature: OwnerClarifiableFeature,
  required: boolean,
) {
  const existing = trip.preferences.some(
    (preference) => preference.feature === feature,
  );
  return {
    ...trip,
    preferences: existing
      ? trip.preferences.map((preference) =>
          preference.feature === feature
            ? { feature, required }
            : { ...preference },
        )
      : [
          ...trip.preferences.map((preference) => ({ ...preference })),
          { feature, required },
        ],
  };
}
