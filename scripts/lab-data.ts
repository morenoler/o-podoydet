import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset, Fact, Hotel } from "../shared/types";

export const labScenarios = [
  "match",
  "mismatch",
  "unknown",
  "stale",
  "conflict",
  "capacity",
] as const;
export type LabScenario = (typeof labScenarios)[number];
export interface LabDataset extends Dataset {
  lab: {
    generatedAt: string;
    listingIds: string[];
    disclaimer: string;
  };
}

const descriptions: Record<LabScenario, { name: string; note: string }> = {
  match: {
    name: "Семейный двор",
    note: "Все три условия подтверждены учебными фактами: семейное размещение, окна во двор и доступ без ступеней. Вместимость — 4 гостя.",
  },
  mismatch: {
    name: "Окна на улицу",
    note: "Семейное размещение есть, но окна выходят на улицу и на пути до номера есть ступени. Обязательные условия двора и доступности исключат вариант.",
  },
  unknown: {
    name: "Неполное описание",
    note: "Семейное размещение указано, сведений об окнах во двор и доступе без ступеней нет. Отсутствие данных остаётся видимым.",
  },
  stale: {
    name: "Пора перепроверить",
    note: "Сведения об окнах во двор устарели. Вместимость, семейное размещение и доступ без ступеней заданы отдельно.",
  },
  conflict: {
    name: "Два разных ответа",
    note: "Два учебных источника противоречат друг другу: один указывает окна во двор, другой — на улицу. Конфликт не скрывается.",
  },
  capacity: {
    name: "Номер на двоих",
    note: "Окна во двор и доступ без ступеней есть, но вместимость — только 2 гостя. Для поездки 2 взрослых и 1 ребёнка вариант исключается.",
  },
};

/** Creates synthetic listings only in a separate lab dataset; never writes to the source. */
export function createLabDataset(
  source: Dataset,
  now = new Date(),
): LabDataset {
  if (
    source.evidencePolicy !== "verified-only" ||
    !Array.isArray(source.hotels) ||
    !Array.isArray(source.facts) ||
    !Array.isArray(source.map) ||
    !Array.isArray(source.bbox) ||
    source.bbox.length !== 4 ||
    !source.bbox.every(Number.isFinite)
  ) {
    throw new Error("Лаборатории нужен исходный каталог с политикой verified-only.");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Некорректная дата генерации.");
  if (
    source.hotels.some((hotel) => hotel.id.startsWith("lab-demo-")) ||
    source.facts.some((fact) => fact.id.startsWith("lab-demo-"))
  ) {
    throw new Error("Исходный каталог уже использует служебные ID lab-demo-.");
  }
  const dataset = structuredClone(source);
  const generatedAt = now.toISOString();
  const offset = (days: number) =>
    new Date(now.getTime() + days * 86_400_000).toISOString();
  const disclaimer =
    "Вымышленное объявление для лабораторной проверки. Отеля, категории номера и источников в действительности не существует; бронирование недоступно.";
  const fixtures: Hotel[] = [];
  const facts: Fact[] = [];

  for (const [index, scenario] of labScenarios.entries()) {
    const id = `lab-demo-${scenario}`;
    const roomId = `${id}-room`;
    const description = descriptions[scenario];
    fixtures.push({
      id,
      synthetic: true,
      name: `ДЕМО · ${description.name}`,
      address: "Вымышленный адрес · только лаборатория",
      lodgingType: "hotel",
      // Deliberately synthetic positions inside the map extent; no OSM object is asserted.
      coordinates: [
        source.bbox[0] + ((source.bbox[2] - source.bbox[0]) * (index + 1)) / 7,
        source.bbox[1] + ((source.bbox[3] - source.bbox[1]) * (index + 1)) / 7,
      ],
      osmUrl: "",
      route: null,
      noise: [],
      dataNotes: [
        description.note,
        disclaimer,
        "Координаты условные. Маршруты, расстояния, безопасность района, воздух и шум для этого объявления не подтверждены.",
      ],
      rooms: [
        {
          id: roomId,
          name: scenario === "capacity" ? "ДЕМО · Номер для двоих" : "ДЕМО · Семейная категория",
          capacity: scenario === "capacity" ? 2 : 4,
          demo: true,
          evidenceStatus: "unknown",
          obtainedAt: generatedAt,
          quote: "Учебное описание вымышленной категории; не официальный источник.",
        },
      ],
    });

    function addFact(
      feature: "family" | "courtyard" | "step_free_access",
      value: boolean,
      options: { suffix?: string; expired?: boolean } = {},
    ) {
      facts.push({
        id: `${id}-${feature}${options.suffix || ""}`,
        hotelId: id,
        roomId,
        feature,
        value,
        source: `Вымышленный учебный источник${options.suffix === "-opposite" ? " Б" : " А"}`,
        quote: `Учебный факт: ${feature}=${value}. ${disclaimer}`,
        method: "demo",
        confidence: "low",
        confidenceReason: "Синтетический тестовый сценарий; не свидетельство о реальном объекте.",
        obtainedAt: options.expired ? offset(-31) : generatedAt,
        expiresAt: options.expired ? offset(-1) : offset(30),
        demo: true,
      });
    }

    addFact("family", true);
    if (scenario !== "unknown") {
      addFact("courtyard", scenario !== "mismatch", { expired: scenario === "stale" });
      addFact("step_free_access", scenario !== "mismatch");
    }
    if (scenario === "conflict") addFact("courtyard", false, { suffix: "-opposite" });
  }

  return {
    ...dataset,
    evidencePolicy: "demo",
    hotels: [...dataset.hotels, ...fixtures],
    facts: [...dataset.facts, ...facts],
    lab: {
      generatedAt,
      listingIds: fixtures.map((hotel) => hotel.id),
      disclaimer:
        "Лабораторный каталог: учебные факты участвуют в подборе только здесь. Реальный каталог и его политика verified-only не изменены.",
    },
  };
}

export async function writeLabDataset(
  sourcePath = "data/verified-hotels.json",
  outputPath = ".local/lab-hotels.json",
  now = new Date(),
): Promise<LabDataset> {
  if (resolve(sourcePath) === resolve(outputPath)) {
    throw new Error("Лабораторный каталог нельзя записывать поверх исходного.");
  }
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as Dataset;
  const dataset = createLabDataset(source, now);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  return dataset;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = process.argv[2] || ".local/lab-hotels.json";
    const dataset = await writeLabDataset("data/verified-hotels.json", output);
    console.log(`Создан лабораторный каталог: ${dataset.lab.listingIds.length} вымышленных объявлений · ${output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Не удалось создать лабораторный каталог.");
    process.exitCode = 1;
  }
}
