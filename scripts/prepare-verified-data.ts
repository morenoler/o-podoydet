import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Dataset, Fact, Room } from "../shared/types";

const url = z.url().refine((s) => s.startsWith("https://"));
const timestamp = z.iso.datetime({ offset: true });
const roomEvidence = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capacity: z.number().int().min(1).max(20).nullable(),
  demo: z.literal(false),
  sourceUrl: url,
  obtainedAt: timestamp,
  sourcePublisher: z.string().optional(),
  publishedView: z.string().optional(),
  limitations: z.array(z.string()).default([]),
  facts: z
    .array(
      z.object({
        feature: z.enum(["family", "courtyard", "step_free_access"]),
        value: z.boolean(),
        paraphrase: z.string().min(1),
        sourceUrl: url,
        obtainedAt: timestamp,
        sourcePublisher: z.string().min(1),
      }),
    )
    .default([]),
});
export const researchSchema = z.object({
  hotels: z.array(
    z.object({
      hotelId: z.string(),
      rooms: z.array(roomEvidence),
      limitations: z.array(z.string()).default([]),
    }),
  ),
});
const expires = (date: string) =>
  new Date(Date.parse(date) + 30 * 86400000).toISOString();

/** Retain real geography; demonstration rooms and facts never enter this dataset. */
export function prepareVerifiedDataset(
  base: Dataset,
  inputs: unknown[],
  now = new Date(),
): Dataset {
  const evidence = inputs.flatMap(
    (input) => researchSchema.parse(input).hotels,
  );
  const knownIds = new Set(base.hotels.map((h) => h.id));
  const roomIds = new Set<string>();
  for (const record of evidence) {
    if (!knownIds.has(record.hotelId))
      throw new Error(`Unknown source hotel: ${record.hotelId}`);
    for (const room of record.rooms) {
      if (
        !room.id.startsWith(`${record.hotelId}-real-`) ||
        roomIds.has(room.id)
      )
        throw new Error(`Invalid or duplicate verified room: ${room.id}`);
      roomIds.add(room.id);
      if (
        Date.parse(room.obtainedAt) > +now ||
        room.facts.some((f) => Date.parse(f.obtainedAt) > +now)
      )
        throw new Error("Source timestamp is in the future");
    }
  }
  const facts: Fact[] = base.facts.filter(
    (f) => f.demo === false && f.method === "geo" && f.feature === "beach_walk",
  );
  const hotels = base.hotels.map((hotel) => {
    const records = evidence.filter((r) => r.hotelId === hotel.id);
    const notes = records.flatMap((r) => r.limitations);
    const rooms: Room[] = records.flatMap((record) =>
      record.rooms.map((sourceRoom) => {
        const room: Room = {
          id: sourceRoom.id,
          name: sourceRoom.name,
          capacity: sourceRoom.capacity,
          demo: false,
          evidenceStatus: "verified",
          sourceUrl: sourceRoom.sourceUrl,
          obtainedAt: sourceRoom.obtainedAt,
          quote: [
            `Официальная категория: ${sourceRoom.name}.${sourceRoom.capacity === null ? " Максимальная вместимость не подтверждена." : ` Опубликованная вместимость: ${sourceRoom.capacity}.`}`,
            sourceRoom.publishedView
              ? `Опубликованный вид: ${sourceRoom.publishedView}. Это не подтверждает окна во двор.`
              : "",
            ["node-7858128118", "way-627150752"].includes(hotel.id) &&
            sourceRoom.capacity === 3
              ? "Дополнительное размещение детей зависит от возраста и отдельного подтверждения отеля."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          capacityMayVary:
            ["node-7858128118", "way-627150752"].includes(hotel.id) &&
            sourceRoom.capacity === 3,
        };
        for (const item of sourceRoom.facts)
          facts.push({
            id: `${room.id}-${item.feature}-official`,
            hotelId: hotel.id,
            roomId: room.id,
            feature: item.feature,
            value: item.value,
            source: item.sourcePublisher,
            sourceUrl: item.sourceUrl,
            quote: item.paraphrase,
            method: "official",
            confidence: "medium",
            confidenceReason:
              "Опубликовано на официальном сайте для конкретной категории; наличие и индивидуальные условия бронирования не проверены.",
            obtainedAt: item.obtainedAt,
            expiresAt: expires(item.obtainedAt),
            demo: false,
          });
        for (const feature of [
          "courtyard",
          "step_free_access",
          "family",
        ] as const) {
          if (sourceRoom.facts.some((f) => f.feature === feature)) continue;
          const quote =
            feature === "courtyard"
              ? `Сторона всех окон этой категории не подтверждена как внутренний двор.${sourceRoom.publishedView ? ` Опубликованный вид: ${sourceRoom.publishedView}.` : ""}`
              : feature === "step_free_access"
                ? "В собранных официальных сведениях нет подтверждения всего пути от улицы до этой категории без ступеней. Наличие лифта само по себе не подтверждает доступность всего пути."
                : "В собранных сведениях для этой категории нет достаточного подтверждения условий размещения с детьми.";
          facts.push({
            id: `${room.id}-${feature}-partial`,
            hotelId: hotel.id,
            roomId: room.id,
            feature,
            value: null,
            source:
              sourceRoom.sourcePublisher || "Официальная страница категории",
            sourceUrl: sourceRoom.sourceUrl,
            quote,
            method: "official",
            confidence: "low",
            confidenceReason:
              "Частичные сведения; положительное или отрицательное совпадение не установлено.",
            obtainedAt: sourceRoom.obtainedAt,
            expiresAt: expires(sourceRoom.obtainedAt),
            demo: false,
          });
        }
        return room;
      }),
    );
    if (!rooms.length)
      rooms.push({
        id: `${hotel.id}-unverified`,
        name: "Категория номера не подтверждена",
        capacity: null,
        demo: false,
        evidenceStatus: "unknown",
      });
    if (hotel.route)
      facts.push({
        id: `${hotel.id}-step-free-route-partial`,
        hotelId: hotel.id,
        feature: "step_free_route",
        value: null,
        source: "OpenStreetMap, локальный пешеходный граф",
        sourceUrl: hotel.osmUrl,
        quote: `На рассчитанном пути ${hotel.route.steps} участков с отмеченными лестницами.${hotel.route.noStepsAlternative ? ` Есть вариант без отмеченных лестниц длиной ${hotel.route.noStepsAlternative.meters} м.` : ""} Вход, бордюры и непрерывный проход без ступеней не обследованы. Доступность всего пути не подтверждена.`,
        method: "geo",
        confidence: "medium",
        confidenceReason:
          "Наблюдаемые отметки OSM не заменяют обследование всего пути.",
        obtainedAt: base.fetchedAt,
        sourceDate: base.sourceDate,
        expiresAt: expires(base.sourceDate),
        demo: false,
      });
    return { ...hotel, rooms, dataNotes: notes };
  });
  return { ...base, evidencePolicy: "verified-only", hotels, facts };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  const result = prepareVerifiedDataset(
    await read("data/demo.json"),
    await Promise.all([
      read("data/verified-rooms-research.json"),
      read("data/verified-access-research.json"),
    ]),
  );
  await writeFile("data/verified-hotels.json", JSON.stringify(result));
  console.log(
    JSON.stringify({
      hotels: result.hotels.length,
      verifiedHotels: result.hotels.filter((h) =>
        h.rooms.some((r) => r.evidenceStatus === "verified"),
      ).length,
      verifiedRooms: result.hotels
        .flatMap((h) => h.rooms)
        .filter((r) => r.evidenceStatus === "verified").length,
      facts: result.facts.length,
      output: "data/verified-hotels.json",
    }),
  );
}
