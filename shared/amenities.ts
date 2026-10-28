/** Structured amenities apply to this offer. Missing/null means unknown, never absent. */
export const amenityIds = [
  "dishwasher", "washing_machine", "pool", "kitchen", "wifi",
  "air_conditioning", "parking", "balcony", "breakfast", "pets_allowed",
] as const;
export type AmenityId = typeof amenityIds[number];
export type AmenityStates = Partial<Record<AmenityId, boolean | null>>;
export interface AmenityEvidence {
  value: boolean | null;
  source: "owner";
  method: "structured_owner_declaration";
  obtainedAt: string;
  sourceDate: null;
  scope: "hotel" | "room";
}
export type AmenityEvidenceMap = Partial<Record<AmenityId, AmenityEvidence>>;

function amenity(label: string, detail: string, scope: "hotel" | "room", question: string, positive: string, negative: string) {
  return { label, detail, scope, question, positive, negative, evaluator: "true" as const, tool: "amenity" as const };
}
export const amenityFeatures = {
  dishwasher: amenity("Посудомоечная машина", "В выбранном номере или квартире", "room", "Есть ли посудомоечная машина в этом варианте размещения?", "Посудомоечная машина в номере", "В номере нет посудомоечной машины"),
  washing_machine: amenity("Стиральная машина", "В выбранном номере; общая прачечная не считается", "room", "Есть ли стиральная машина в самом номере или квартире?", "Стиральная машина в номере", "В номере нет стиральной машины"),
  pool: amenity("Бассейн", "Бассейн на территории; режим и плату уточняют отдельно", "hotel", "Есть ли бассейн на территории и доступен ли он на даты поездки?", "На территории есть бассейн", "На территории нет бассейна"),
  kitchen: amenity("Своя кухня", "В номере или квартире; общая кухня не считается", "room", "Есть ли собственная кухня в этом варианте размещения?", "В номере есть своя кухня", "В номере нет своей кухни"),
  wifi: amenity("Wi-Fi в номере", "Наличие сети; скорость требует отдельного уточнения", "room", "Доступен ли Wi-Fi в самом номере?", "В номере доступен Wi-Fi", "В номере нет Wi-Fi"),
  air_conditioning: amenity("Кондиционер", "В выбранном номере или квартире", "room", "Есть ли кондиционер в этом варианте размещения?", "В номере есть кондиционер", "В номере нет кондиционера"),
  parking: amenity("Парковка", "На территории; место и стоимость уточняют отдельно", "hotel", "Есть ли парковка на территории и нужно ли бронировать место?", "На территории есть парковка", "На территории нет парковки"),
  balcony: amenity("Балкон", "В выбранном номере; вид с балкона не подразумевается", "room", "Есть ли собственный балкон у этого варианта размещения?", "У номера есть балкон", "У номера нет балкона"),
  breakfast: amenity("Завтрак", "Предлагается объектом; включение в цену не подразумевается", "hotel", "Предлагается ли завтрак и входит ли он в стоимость?", "Объект предлагает завтрак", "Объект не предлагает завтрак"),
  pets_allowed: amenity("Можно с питомцем", "Для этого варианта; ограничения и доплату нужно уточнить", "room", "Разрешены ли питомцы в этом варианте и какие есть ограничения?", "В этом варианте разрешены питомцы", "В этом варианте питомцы не разрешены"),
} satisfies Record<AmenityId, ReturnType<typeof amenity>>;

export function isAmenityId(value: string): value is AmenityId {
  return (amenityIds as readonly string[]).includes(value);
}

/** Display deduplication only. Never turns old labels into searchable facts. */
export function additionalAmenityLabels(labels: string[]): string[] {
  const controlled = new Set([
    ...Object.values(amenityFeatures).map(feature => feature.label.toLocaleLowerCase("ru-RU")),
    "wi-fi", "wifi", "вай-фай", "кухня", "можно с питомцами", "бассейн на территории",
  ]);
  return labels.filter(label => !controlled.has(label.trim().toLocaleLowerCase("ru-RU")));
}
