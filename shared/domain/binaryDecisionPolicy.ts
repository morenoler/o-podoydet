import type { Criterion, CriterionDecision, Hotel, OccupancyRule, Room, RoomMatch, Trip } from "../types";
import { amenityIds, amenityFeatures } from "../amenities";

/** Admission stays binary; missing evidence never becomes a positive hotel fact. */
export function decideCriterion(raw: Criterion, _hotel: Hotel): CriterionDecision {
  const result = { ...raw, evidenceStatus: raw.status, sourceExplanation: raw.explanation };
  if (raw.status === "match" || raw.status === "mismatch")
    return { ...result, status: raw.status, assumed: false, decisionBasis: "evidence" };
  const reasons: Record<Criterion["feature"], string> = {
    ...Object.fromEntries(amenityIds.map(id => [id, `${amenityFeatures[id].label}: нет достаточных сведений для выбранного варианта размещения.`])) as Record<typeof amenityIds[number], string>,
    beach_walk: "Нет пригодного подтверждения расстояния до пляжа. Сохранённый маршрут не заменяет недостающие, устаревшие или противоречивые сведения.",
    step_free_route: "Отсутствие лестниц на карте и рассчитанный обход не подтверждают доступность всего пути без ступеней.",
    courtyard: "Направление окон выбранного номера не подтверждено.",
    step_free_access: "Доступ без ступеней на всём пути до выбранного номера не подтверждён.",
    family: "Тип размещения не подтверждает условия для семьи в выбранной категории номера.",
    area_safety: "Недостаточно сопоставимых сведений для подтверждения условия. Это не вывод об опасности района.",
    clean_air: "Нет достаточных данных о качестве воздуха на даты поездки. Текущий AQI не является прогнозом на поездку.",
    low_noise: "Расстояние до дороги и историческая транспортная нагрузка не подтверждают тишину в выбранном номере на даты поездки.",
  };
  const reason = reasons[raw.feature];
  const context = raw.status === "stale" ? "Сведения устарели." :
    raw.status === "conflict" ? "Источники противоречат друг другу." : "Недостаточно данных.";
  return { ...result, status: "mismatch", assumed: true, decisionBasis: "estimate",
    assumption: reason, explanation: context + " Требуется уточнение: " + reason };
}

function freshSource(value: { sourceUrl?: string; obtainedAt?: string; quote?: string }, now: Date) {
  try {
    const url = new URL(value.sourceUrl || "");
    const obtained = Date.parse(value.obtainedAt || "");
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname &&
      !url.username && !url.password && !!value.quote?.trim() &&
      Number.isFinite(obtained) && obtained <= +now && +now - obtained <= 30 * 86400000;
  } catch { return false; }
}

function validRule(rule: OccupancyRule, now: Date) {
  if (!rule || typeof rule !== "object" || !freshSource(rule, now)) return false;
  if (!Number.isInteger(rule.maxGuests) || rule.maxGuests < 1 || rule.maxGuests > 20) return false;
  for (const field of ["maxAdults", "maxChildren", "minChildren", "childMaxAge"] as const) {
    const value = rule[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 20)) return false;
  }
  if ((rule.maxAdults ?? 0) > rule.maxGuests || (rule.maxChildren ?? 0) > rule.maxGuests ||
      (rule.minChildren ?? 0) > (rule.maxChildren ?? rule.maxGuests)) return false;
  return true;
}

export function decideCapacity(_hotel: Hotel, room: Room, trip: Trip, now = new Date()): Pick<
  RoomMatch, "capacityStatus" | "capacityEvidenceStatus" | "capacityAssumed" | "capacityExplanation" | "capacityRule"
> {
  const known = Number.isInteger(room.capacity) && room.capacity! > 0;
  const total = trip.adults + trip.children;
  if (known && room.capacity! >= total)
    return { capacityStatus: "match", capacityEvidenceStatus: "match", capacityAssumed: false,
      capacityExplanation: "Указанной вместимости достаточно для всех гостей." };
  const rules = Array.isArray(room.occupancyRules) ? room.occupancyRules : [];
  const applicable = room.demo === false && room.evidenceStatus === "verified" && freshSource(room, now)
    ? rules.find((rule) => validRule(rule, now) && total <= rule.maxGuests &&
      trip.adults <= (rule.maxAdults ?? rule.maxGuests) &&
      trip.children <= (rule.maxChildren ?? rule.maxGuests) &&
      trip.children >= (rule.minChildren ?? 0) &&
      // Trip does not collect ages; never assume that children meet an age limit.
      !(trip.children > 0 && rule.childMaxAge !== undefined))
    : undefined;
  if (applicable)
    return { capacityStatus: "match", capacityEvidenceStatus: "match", capacityAssumed: false,
      capacityRule: applicable,
      capacityExplanation: "Опубликованное правило размещения допускает этот состав гостей. Наличие номера на даты не проверено." };
  const unresolved = !known || !!room.capacityMayVary || rules.length > 0;
  return { capacityStatus: "mismatch", capacityEvidenceStatus: unresolved ? "unknown" : "mismatch",
    capacityAssumed: unresolved, capacityExplanation: unresolved
      ? rules.some((rule) => rule && rule.childMaxAge !== undefined) && trip.children > 0
        ? "Вместимость требует уточнения: опубликованное правило ограничивает возраст детей, а их возраст не указан."
        : "Вместимость требует уточнения: нет достаточных подтверждений для этого состава гостей. Это не установленный недостаток мест."
      : "Указанная вместимость меньше числа гостей." };
}
