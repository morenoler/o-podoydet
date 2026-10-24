import type {
  Criterion,
  CriterionDecision,
  Hotel,
  Room,
  RoomMatch,
  Trip,
} from "../types";

const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Product decisions do not rewrite the evidence that produced them. */
export function decideCriterion(
  raw: Criterion,
  hotel: Hotel,
): CriterionDecision {
  const result = {
    ...raw,
    evidenceStatus: raw.status,
    sourceExplanation: raw.explanation,
  };
  if (raw.status === "match" || raw.status === "mismatch")
    return {
      ...result,
      status: raw.status,
      assumed: false,
      decisionBasis: "evidence",
    };

  let match = false;
  let reason: string;
  const route = hotel.route;
  switch (raw.feature) {
    case "beach_walk":
      match = nonnegative(route?.meters) && route.meters <= 1000;
      reason = route
        ? "Используем сохранённое расстояние до пляжа и порог 1 км."
        : "Без рассчитанного маршрута считаем фильтр близости пляжа невыполненным.";
      break;
    case "step_free_route":
      match =
        !!route &&
        (route.steps === 0 || nonnegative(route.noStepsAlternative?.meters));
      reason =
        "Оцениваем путь по отметкам лестниц и обходу на карте; весь путь не обследован.";
      break;
    case "courtyard":
      reason =
        "Без подтверждения окон во двор считаем этот фильтр невыполненным.";
      break;
    case "step_free_access":
      reason =
        "Без подтверждения всего пути до номера считаем фильтр доступа без ступеней невыполненным.";
      break;
    case "family":
      match = ["hotel", "guest_house", "apartment"].includes(
        hotel.lodgingType || "",
      );
      reason =
        "Грубая оценка по типу размещения: отели, гостевые дома и апартаменты считаем подходящими для семьи; условия конкретного номера не подтверждены.";
      break;
    case "area_safety":
      reason =
        "Нет сопоставимого показателя для этого фильтра: считаем условие невыполненным. Это не вывод об опасности района.";
      break;
    case "clean_air":
      match = nonnegative(raw.currentAirUsAqi) && raw.currentAirUsAqi <= 50;
      reason = nonnegative(raw.currentAirUsAqi)
        ? `Грубая оценка по текущему US AQI ${raw.currentAirUsAqi} на ${raw.currentAirTime}: принимаем значения не выше 50. Это не прогноз на даты поездки.`
        : "Без полного прогноза на поездку считаем фильтр чистого воздуха невыполненным.";
      break;
    case "low_noise": {
      if (
        raw.assessmentBasis === "historical" &&
        raw.riskLevel &&
        raw.riskLevel !== "unknown"
      ) {
        match = raw.riskLevel === "low";
        reason =
          "Грубая оценка по исторической транспортной нагрузке: принимаем только низкий расчётный риск. Это не прогноз и не измерение шума на даты поездки.";
      } else {
        const nearest = nonnegative(raw.nearestRoadMeters)
          ? raw.nearestRoadMeters
          : Math.min(
              ...hotel.noise
                .filter((s) => s.kind === "road" && nonnegative(s.meters))
                .map((s) => s.meters),
            );
        match = Number.isFinite(nearest) && nearest > 150;
        reason = Number.isFinite(nearest)
          ? `Грубая оценка по ближайшей отмеченной дороге: ${Math.round(nearest)} м; фильтр проходит при расстоянии больше 150 м. Это не замер шума.`
          : "Нет данных даже о ближайшей дороге; считаем фильтр внешнего шума невыполненным.";
      }
      break;
    }
  }
  return {
    ...result,
    status: match ? "match" : "mismatch",
    assumed: true,
    decisionBasis: "estimate",
    assumption: reason,
    explanation: `Оценка: ${reason}`,
  };
}

export function decideCapacity(
  hotel: Hotel,
  room: Room,
  trip: Trip,
): Pick<
  RoomMatch,
  | "capacityStatus"
  | "capacityEvidenceStatus"
  | "capacityAssumed"
  | "capacityExplanation"
  | "estimatedCapacity"
> {
  const known = Number.isInteger(room.capacity) && room.capacity! > 0;
  const count = known
    ? room.capacity!
    : hotel.lodgingType === "apartment"
      ? 4
      : 2;
  const match = count >= trip.adults + trip.children;
  const conditional = known && !match && !!room.capacityMayVary;
  return {
    capacityStatus: match ? "match" : "mismatch",
    capacityEvidenceStatus:
      !known || conditional ? "unknown" : match ? "match" : "mismatch",
    capacityAssumed: !known || conditional,
    ...(!known ? { estimatedCapacity: count } : {}),
    capacityExplanation: !known
      ? `Оценка: предполагаем вместимость ${count} гостей по типу размещения.`
      : conditional
        ? "Оценка: не учитываем условное увеличение вместимости без подтверждения условий."
        : match
          ? "Указанной вместимости достаточно для всех гостей."
          : "Указанная вместимость меньше числа гостей.",
  };
}
