import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  noiseContextSchema,
  trafficObservationSchema,
  noiseEventSchema,
  evaluateNoise,
  type NoiseContext,
} from "../shared/noise";
import type { Dataset, Point } from "../shared/types";
import type { OsmElement } from "../shared/geo";

const args = process.argv.slice(2);
const allowed = new Set([
  "--traffic",
  "--historical-traffic",
  "--events",
  "--event-coverage",
  "--traffic-coverage",
  "--validate",
  "--hotel",
  "--check-in",
  "--check-out",
]);
for (let i = 0; i < args.length; i += 2)
  if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(
      "Expected --traffic FILE, --events FILE, --event-coverage FILE, --traffic-coverage FILE, --validate FILE, or --hotel ID --check-in DATE --check-out DATE",
    );
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const readJson = async (path: string) =>
  JSON.parse(await readFile(resolve(path), "utf8"));

if (option("--validate")) {
  const validated = noiseContextSchema.parse(
    await readJson(option("--validate")!),
  );
  console.log(
    JSON.stringify({
      valid: true,
      region: validated.region,
      roads: validated.roads.length,
      trafficObservations: validated.trafficObservations.length,
      events: validated.events.length,
    }),
  );
} else {
  const snapshot = (await readJson(
    "data/osm-busan-haeundae-snapshot.json",
  )) as { regionKey: string; fetchedAt: string; elements: OsmElement[] };
  const dataset = (await readJson("data/demo.json")) as Dataset;
  const historicalPath =
    option("--historical-traffic") ||
    process.env.TRAFFIC_DATA_PATH ||
    "data/traffic-ktdb-2024.json";
  const historicalTraffic = await readJson(historicalPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && !option("--historical-traffic"))
        return undefined;
      throw error;
    },
  );
  if (snapshot.regionKey !== "busan-haeundae" || dataset.region !== "Пусан")
    throw new Error("Real Busan / Haeundae data is required");
  const roadClasses = new Set([
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "residential",
    "unclassified",
    "living_street",
    "service",
  ]);
  const roads = snapshot.elements
    .filter(
      (e) =>
        e.type === "way" &&
        e.geometry &&
        e.geometry.length > 1 &&
        roadClasses.has(e.tags?.highway || "") &&
        e.tags?.area !== "yes" &&
        e.tags?.tunnel !== "yes" &&
        e.tags?.motor_vehicle !== "no",
    )
    .map((e) => ({
      id: `way-${e.id}`,
      name: e.tags?.["name:en"] || e.tags?.name || "Дорога без названия",
      roadClass: e.tags!.highway,
      geometry: e.geometry!.map((p) => [p.lon, p.lat] as Point),
      oneWay: ["yes", "1", "-1"].includes(e.tags?.oneway || ""),
      source: {
        url: `https://www.openstreetmap.org/way/${e.id}`,
        publisher: "OpenStreetMap contributors",
        retrievedAt: snapshot.fetchedAt,
      },
    }));
  const trafficInput = option("--traffic")
    ? await readJson(option("--traffic")!)
    : { trafficObservations: [] };
  if (!Array.isArray(trafficInput.trafficObservations))
    throw new Error("Traffic import must contain trafficObservations[]");
  const trafficObservations = trafficInput.trafficObservations.map(
    (item: unknown) => trafficObservationSchema.parse(item),
  );
  const eventInput = await readJson(
    option("--events") || "data/noise-events.json",
  );
  if (!Array.isArray(eventInput.events))
    throw new Error("Event import must contain events[]");
  const events = eventInput.events.map((item: unknown) =>
    noiseEventSchema.parse(item),
  );
  const generatedAt = new Date().toISOString();
  const eventCoverage = option("--event-coverage")
    ? await readJson(option("--event-coverage")!)
    : {
        status: "partial",
        verifiedAt: generatedAt,
        reason:
          "Проверены отдельные официальные карточки мероприятий. Полнота календаря по всем районам, площадкам и датам не подтверждена; отсутствие совпадения не означает отсутствия событий.",
        sourceUrls: [
          "https://www.busan.go.kr/eng/bsevents/1752782",
          "https://www.busanfireworks.com/en/",
          "https://www.busan.go.kr/eng/bsevents/1725994",
          "https://www.busan.go.kr/eng/bsevents/1705138",
        ],
      };
  const context = noiseContextSchema.parse({
    schemaVersion: 1,
    region: "Пусан",
    timeZone: "Asia/Seoul",
    generatedAt,
    bbox: dataset.bbox,
    roads,
    trafficObservations,
    events,
    coverage: {
      traffic: option("--traffic-coverage")
        ? await readJson(option("--traffic-coverage")!)
        : {
            status: trafficObservations.length ? "partial" : "unavailable",
            reason: trafficObservations.length
              ? "Импортированы наблюдения с указанными периодами и направлением. Полнота по всему сроку поездки проверяется отдельно; наблюдения не являются прогнозом."
              : "Датированные наблюдения движения на срок поездки не загружены. Исторические почасовые профили KTDB учитываются отдельно как предварительный фон; они не подтверждают движение или тишину на выбранные даты.",
            sourceUrls: [
              "https://its.busan.go.kr/",
              "https://www.busan.go.kr/depart/trafficcensus0101",
              "https://www.utic.go.kr/guide/utisRefTraffic.do",
              "https://www.its.go.kr/opendata/intro",
            ],
          },
      events: eventCoverage,
    },
    assumptions: [
      "Модель risk-v1 не калибрована по акустическим измерениям и не рассчитывает дБ.",
      "Ближние дороги: до 300 м до реального сегмента. Базовая близость: high до 50 м, moderate до 150 м, low до 300 м — не загрузка движения.",
      "Нормализация: vehicleCount / intervalHours / lanes. lanes — число полос, реально включённых в счёт; направление должно быть известно.",
      "Эвристика нагрузки на полосу: до 300 авт/ч low; до 700 moderate; выше 700 high. Скорость сама по себе не определяет число автомобилей и уровень шума.",
      "Для high-нагрузки: расстояние до 75 м high; до 150 м moderate; дальше low. Для moderate-нагрузки: до 150 м moderate; дальше low.",
      "Событие учитывается только при пересечении времени поездки и модельной зоны. high-потенциал: внутренняя половина радиуса high, внешняя moderate; остальные уровни сохраняются.",
      "Радиусы событий и noisePotential — явно неподтверждённые акустически допущения по типу программы. Общенациональный выходной без локального события не создаёт риск.",
      "Исторические наблюдения применяются только к своим датированным интервалам; их не переносят на будущие дни или одинаковые дни недели.",
      "Низкий суммарный риск требует покрытия счётом автомобилей всех близких дорог за весь срок поездки и подтверждённо полного календаря для периода/территории. В текущем публичном наборе таких доказательств нет.",
    ],
  }) satisfies NoiseContext;
  await writeFile("data/noise-context.json", JSON.stringify(context, null, 2));
  if (option("--hotel")) {
    const hotel = dataset.hotels.find((h) => h.id === option("--hotel"));
    if (!hotel || !option("--check-in") || !option("--check-out"))
      throw new Error("A known hotel and both trip dates are required");
    console.log(
      JSON.stringify(
        evaluateNoise(
          context,
          hotel.coordinates,
          option("--check-in")!,
          option("--check-out")!,
          new Date(),
          historicalTraffic,
        ),
        null,
        2,
      ),
    );
  } else
    console.log(
      JSON.stringify({
        region: context.region,
        roads: roads.length,
        trafficObservations: trafficObservations.length,
        events: events.length,
        eventCoverage: eventCoverage.status,
        output: "data/noise-context.json",
      }),
    );
}
