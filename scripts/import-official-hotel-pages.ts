/** Explicit, bounded public-page collection; ordinary import reuses saved projections. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const CACHE = "data/official-source-cache";
export const PARSER_VERSION = "official-html-v3";
const MAX_BYTES = 3_000_000;
const shilla = "https://www.shillahotels.com/en/shillastay/haeundae/accommodation/";
const josun = "https://gjb.josunhotel.com/rooms/";
export interface SourceSpec {
  id: string; hotelId: string; url: string; kind: "shilla" | "josun" | "josun-policy";
  expectedName?: string; roomId?: string;
}
export const SOURCES: SourceSpec[] = [
  ...[
    ["standard", "Standard", "standard"],
    ["standardTwin", "Standard Family Twin", "standard-family-twin"],
    ["deluxe", "Deluxe", "deluxe"],
    ["deluxeFamilyTwin", "Deluxe Family Twin", "deluxe-family-twin"],
    ["premierDeluxe", "Premier Deluxe", "premier-deluxe"],
    ["premierDeluxeFamilyTwin", "Premier Deluxe Family Twin", "premier-deluxe-family-twin"],
    ["ondolSuite", "Ondol Suite", "ondol-suite"],
    ["juniorSuite", "Junior Suite", "junior-suite"],
    ["grandSuite", "Grand Suite", "grand-suite"],
  ].map(([slug, expectedName, key]) => ({ id: `shilla-${slug}`, hotelId: "way-627150752", url: `${shilla}${slug}.do`, kind: "shilla" as const, expectedName, roomId: `way-627150752-real-${key}` })),
  ...[
    ["kidsSuperior", "Kids Superior", "kids-superior"],
    ["kidsDeluxe", "Kids Deluxe", "kids-deluxe"],
    ["kidsSuite", "Kids Suite", "kids-suite"],
    ["familySuite", "Family Corner Suite", "family-corner-suite"],
  ].map(([slug, expectedName, key]) => ({ id: `josun-${slug}`, hotelId: "way-843161717", url: `${josun}${slug}.do`, kind: "josun" as const, expectedName, roomId: `way-843161717-real-${key}` })),
  { id: "josun-family-policy", hotelId: "way-843161717", url: "https://gjb.josunhotel.com/about/faq.do?_method=list", kind: "josun-policy" },
];

export interface OccupancyRule {
  maxGuests: number; maxAdults?: number; maxChildren?: number; minChildren?: number;
  childMaxAge?: number; sourceUrl: string; obtainedAt: string; quote: string;
}
export interface Projection {
  name?: string; capacity?: number | null; publishedView?: string;
  family?: true; wifi?: true; workDesk?: true;
  extraChildCapacity?: number; childMaxAge?: number;
  occupancyExceptionUnresolved?: true;
  policy?: { maxGuests: number; maxAdults: number; maxChildren: number; childMaxAge: number };
  excerpts: string[]; limitations: string[]; evidenceSelectors: Record<string, string>;
}
export interface SourceSnapshot {
  schemaVersion: 1; sourceId: string; hotelId: string; url: string; obtainedAt: string;
  sourceUpdatedAt: null; responseSha256: string; responseBytes: number;
  parserVersion: string; projection: Projection; projectionSha256: string;
  method: "official"; demo: false;
  cacheLimitations: string;
}
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export function plain(html: string): string {
  return html.replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style)\b[^]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&ndash;|&#8211;/gi, "–").replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ").trim();
}
function field(html: string, label: string): string | undefined {
  for (const m of html.matchAll(/<dt\b[^>]*>([^]*?)<\/dt>\s*<dd\b[^>]*>([^]*?)<\/dd>/gi)) {
    if (plain(m[1]).toLowerCase() === label.toLowerCase()) return plain(m[2]);
  }
}
function requireText(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function classTokens(opening: string): string[] {
  return (opening.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] || "").split(/\s+/);
}
function closingElement(html: string, start: number, tag: string): number {
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(html));) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  throw new Error(`Unclosed ${tag} evidence container`);
}
/** Exact class token and balanced boundaries; never read until the page footer. */
function sectionByClass(html: string, tag: string, token: string): string {
  const matches = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))]
    .filter(m => classTokens(m[0]).includes(token));
  requireText(matches.length === 1, `Expected one ${token} evidence container`);
  const match = matches[0];
  return html.slice(match.index!, closingElement(html, match.index!, tag));
}
function withoutNonEvidence(html: string): string {
  let cleaned = html.replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style)\b[^]*?<\/\1\s*>/gi, " ");
  const openings = /<(nav|aside|header|footer|div|section|ul)\b[^>]*>/gi;
  for (let match; (match = openings.exec(cleaned));) {
    const excluded = /^(nav|aside|header|footer)$/i.test(match[1]) ||
      classTokens(match[0]).some(c => /(?:^|[-_])(?:related|recommend\w*|navigation|breadcrumb|ad-area)(?:$|[-_])/i.test(c));
    if (!excluded) continue;
    const end = closingElement(cleaned, match.index, match[1]);
    cleaned = cleaned.slice(0, match.index) + " " + cleaned.slice(end);
    openings.lastIndex = match.index + 1;
  }
  return cleaned;
}
function boundedProjection(p: Projection): Projection {
  const words = p.excerpts.join(" ").trim().split(/\s+/).length;
  if (words > 25) throw new Error(`Excerpt budget exceeded: ${words}`);
  if (JSON.stringify(p).length > 12_000) throw new Error("Projection too large");
  return p;
}
export function parseOfficialPage(spec: SourceSpec, html: string): Projection {
  if (Buffer.byteLength(html) > MAX_BYTES) throw new Error("Response too large");
  const title = plain(html.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1] || "");
  if (spec.kind === "shilla") {
    requireText(title.includes("Shilla Stay Haeundae"), "Wrong Shilla property or JavaScript shell");
    const name = title.split("|")[0].trim();
    requireText(name === spec.expectedName, "Category title does not match requested page");
    const cleaned = withoutNonEvidence(html);
    const section = sectionByClass(cleaned, "div", "room-detail");
    const overview = sectionByClass(section, "div", "property-overview");
    const info = sectionByClass(overview, "div", "room-info-box");
    const guests = field(info, "Guests");
    requireText(guests, "Category Guests field missing; booking-widget counts are not occupancy");
    const count = guests.match(/^(?:\d+\s*[–—~-]\s*)?(\d+)\s+guests?$/i);
    requireText(count, "Unexpected Guests field; manual review needed");
    const capacity = Number(count[1]);
    requireText(capacity >= 1 && capacity <= 20, "Invalid category occupancy");
    const view = field(info, "View");
    const extra = plain(overview).match(/When accompanied by a child, up to (\d+) guests may stay in the room\b\.?/i);
    // The public booking form defines the publisher's child range; do not omit
    // this qualification just to turn a four-person family search green.
    const age = plain(cleaned).match(/Children\s*:\s*Aged\s+37\s+months\s+to\s+(\d+)\s+years/i);
    const knownAge = age && Number(age[1]) >= 3 && Number(age[1]) <= 17;
    if (extra) requireText(Number(extra[1]) > capacity && Number(extra[1]) <= 20, "Unexpected child occupancy exception");
    const amenities = sectionByClass(section, "div", "amenities-list");
    const wifi = /Complimentary high-speed wired and wireless\s*\(Wi-Fi\)\s*internet/i.test(plain(amenities));
    const desk = /<li\b[^>]*>\s*(?:Work\s+)?Desk\s*<\/li>/i.test(amenities);
    const excerpts = [name, guests, ...(view ? [view] : [])];
    if (extra) excerpts.push(`up to ${extra[1]} guests`);
    if (extra && knownAge) excerpts.push(`37 months to ${age![1]} years`);
    if (wifi) excerpts.push("Wi-Fi");
    return boundedProjection({ name, capacity, publishedView: view,
      ...(/Family/i.test(name) || extra ? { family: true as const } : {}),
      ...(wifi ? { wifi: true as const } : {}), ...(desk ? { workDesk: true as const } : {}),
      ...(extra && knownAge ? { extraChildCapacity: Number(extra[1]), childMaxAge: Number(age![1]) } : {}),
      ...(extra && !knownAge ? { occupancyExceptionUnresolved: true as const } : {}),
      excerpts, evidenceSelectors: { name: "title before |", capacity: ".room-detail .property-overview .room-info-box dt=Guests + dd", publishedView: ".room-detail .property-overview .room-info-box dt=View + dd", childRule: ".room-detail .property-overview child occupancy sentence", childAge: "official booking-form Children age definition", amenities: ".room-detail .amenities-list, excluding navigation and related content" },
      limitations: ["Категория номера, а не физический номер; наличие на даты не проверялось.", "City/Ocean — варианты вида в категории, а не обещание каждого вида в одном номере.", "Ступени, вход, лифт и полный доступ до номера не подтверждены.", ...(extra ? ["Увеличение вместимости условно: нужен ребёнок; возрастная категория издателя требует проверки возраста. Младенцы до 36 месяцев учитываются отдельно, это правило их размещение не устанавливает."] : []), ...(extra && !knownAge ? ["Возрастное определение ребёнка отсутствует или изменилось: исключение для дополнительного гостя не импортировано как применимое правило; базовая вместимость сохранена."] : [])],
    });
  }
  if (spec.kind === "josun-policy") {
    requireText(title.includes("그랜드 조선 부산"), "Wrong Josun property");
    const text = plain(html);
    const composition = text.match(/한 객실 당 성인 (\d+)인과 어린이 (\d+)인으로 (\d+)인 가족 기준입니다\./);
    const ages = text.match(/투숙 기준 소인 나이는 0세부터 (\d+)세입니다\./);
    requireText(composition && ages, "Exact hotel-level family occupancy policy missing");
    return boundedProjection({ policy: { maxAdults: Number(composition[1]), maxChildren: Number(composition[2]), maxGuests: Number(composition[3]), childMaxAge: Number(ages[1]) }, excerpts: [composition[0], ages[0]], evidenceSelectors: { composition: "FAQ: standard room occupancy answer", childAge: "FAQ: child age definition answer" }, limitations: ["Правило отеля относится к составу семьи, не даёт безусловную вместимость четырёх взрослых.", "Доплата и исключения для дополнительных гостей не импортируются как безусловное разрешение."] });
  }
  requireText(title.includes("그랜드 조선 부산"), "Wrong Josun property");
  const start = html.indexOf('id="container"');
  requireText(start >= 0, "Josun room container missing");
  const section = html.slice(start);
  const name = plain(section.match(/<strong\b[^>]*class="tit"[^>]*>([^]*?)<\/strong>/i)?.[1] || "");
  requireText(name === spec.expectedName, "Josun category title mismatch");
  const info = section.match(/<div\b[^>]*class="propertyInfo"[^>]*>([^]*?)<\/ul>/i)?.[1];
  requireText(info, "Josun category property section missing");
  const view = field(info, "VIEW");
  return boundedProjection({ name, capacity: null, family: true,
    publishedView: view, excerpts: [name, ...(view ? [view] : [])],
    evidenceSelectors: { name: "#container .topViewCont strong.tit", publishedView: ".propertyInfo dt=VIEW + dd", capacity: "No category-specific general maximum is published in this fieldset" },
    limitations: ["Детская/семейная категория подтверждена названием и описанием; общий максимум категории не установлен.", "Море в оформлении Kids не является видом из окна; импортируется только поле VIEW.", "Вместимость lounge и число кроватей не используются как вместимость номера.", "Непрерывный путь от улицы до номера без ступеней не подтверждён."],
  });
}
export function makeSnapshot(spec: SourceSpec, body: string, obtainedAt: string): SourceSnapshot {
  const projection = parseOfficialPage(spec, body);
  return { schemaVersion: 1, sourceId: spec.id, hotelId: spec.hotelId, url: spec.url, obtainedAt,
    sourceUpdatedAt: null, responseSha256: hash(body), responseBytes: Buffer.byteLength(body),
    parserVersion: PARSER_VERSION, projection, projectionSha256: hash(JSON.stringify(projection)), method: "official", demo: false,
    cacheLimitations: "Bounded extracted fields and <=25 words of excerpts are retained. Full HTML is not distributed. The response hash cannot be recomputed offline; projection integrity can. A fresh collection is required to rerun HTML extraction.",
  };
}
function validateSnapshot(spec: SourceSpec, s: SourceSnapshot) {
  requireText(s.sourceId === spec.id && s.hotelId === spec.hotelId && s.url === spec.url, "Cache source/property mismatch");
  requireText(s.parserVersion === PARSER_VERSION && s.projectionSha256 === hash(JSON.stringify(s.projection)), "Cache projection/version mismatch");
  requireText(s.demo === false && s.method === "official" && Number.isFinite(Date.parse(s.obtainedAt)), "Invalid cache provenance");
  requireText(Date.parse(s.obtainedAt) <= Date.now(), "Future cache provenance");
  boundedProjection(s.projection);
}
async function fetchSource(spec: SourceSpec): Promise<SourceSnapshot> {
  // The allowlist is the checked source manifest above; no arbitrary input URL,
  // authentication, cookies, redirect following, or access-control workaround.
  requireText(SOURCES.some(s => s.id === spec.id && s.url === spec.url), "URL not allowlisted");
  const { stdout } = await exec(process.platform === "win32" ? "curl.exe" : "curl", ["-4", "--fail", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "35", "--max-filesize", String(MAX_BYTES), "--proto", "=https", spec.url], { encoding: "utf8", maxBuffer: MAX_BYTES, timeout: 40_000 });
  return makeSnapshot(spec, stdout, new Date().toISOString());
}
export function mergeSnapshots(research: any, snapshots: SourceSnapshot[]) {
  const output = structuredClone(research);
  const policy = snapshots.find(s => s.sourceId === "josun-family-policy");
  for (const s of snapshots) {
    const p = s.projection;
    if (!p.name) continue;
    const spec = SOURCES.find(x => x.id === s.sourceId)!;
    const hotel = output.hotels.find((h: any) => h.hotelId === spec.hotelId);
    if (!hotel) throw new Error(`Unmapped hotel ${spec.hotelId}`);
    const publisher = spec.kind === "shilla" ? "Shilla Stay Haeundae / SHILLA HM" : "Grand Josun Busan / JOSUN HOTELS & RESORTS";
    const occupancyRules: OccupancyRule[] = [];
    if (p.extraChildCapacity && p.childMaxAge !== undefined) occupancyRules.push({ maxGuests: p.extraChildCapacity, minChildren: 1,
      ...(p.childMaxAge !== undefined ? { childMaxAge: p.childMaxAge } : {}), sourceUrl: s.url, obtainedAt: s.obtainedAt,
      quote: `На странице этой категории разрешено до ${p.extraChildCapacity} гостей при размещении с ребёнком.${p.childMaxAge ? ` В форме отеля дети определены как возраст от 37 месяцев до ${p.childMaxAge} лет; младенцы выделены отдельно. Без возраста применимость исключения не подтверждена.` : ""}` });
    if (spec.kind === "josun" && policy?.projection.policy) occupancyRules.push({ ...policy.projection.policy,
      sourceUrl: policy.url, obtainedAt: policy.obtainedAt,
      quote: "Официальный FAQ устанавливает стандартное размещение семьи: 2 взрослых и 2 ребёнка, возраст ребёнка 0–12 лет. Это общее правило отеля, не разрешение на четырёх взрослых; возраст детей и наличие категории нужно проверить." });
    const room = { id: spec.roomId, name: p.name, capacity: p.capacity ?? null, demo: false,
      scope: "room_category", sourceUrl: s.url, sourcePublisher: publisher, obtainedAt: s.obtainedAt,
      publishedView: p.publishedView, occupancyRules,
      capacityMayVary: Boolean(p.occupancyExceptionUnresolved || occupancyRules.length),
      publishedInformation: { wifi: p.wifi ?? null, workDesk: p.workDesk ?? null,
        viewOptions: p.publishedView ?? null, evidenceKind: "publisher_reported", sourceUrl: s.url,
        limitations: ["Wi-Fi означает опубликованное наличие, не измеренную скорость.", "Варианты вида категории не подтверждают вид из конкретного номера."] },
      provenance: { sourceId: s.sourceId, sourceUpdatedAt: null, responseSha256: s.responseSha256,
        projectionSha256: s.projectionSha256, parserVersion: s.parserVersion },
      facts: p.family ? [{ feature: "family", value: true,
        paraphrase: `Официальная страница категории ${p.name} прямо указывает семейное назначение либо разрешение на размещение с ребёнком. Вместимость и возрастные условия проверяются отдельно.`,
        sourceUrl: s.url, obtainedAt: s.obtainedAt, sourcePublisher: publisher }] : [],
      limitations: p.limitations,
    };
    const existing = hotel.rooms.findIndex((r: any) => r.id === room.id);
    if (existing >= 0) hotel.rooms[existing] = room; else hotel.rooms.push(room);
    hotel.checkedUrls = [...new Set([...(hotel.checkedUrls || []), s.url, ...(spec.kind === "josun" && policy ? [policy.url] : [])])];
    hotel.limitations = ["Сведения о категориях опубликованы отелем; свободные номера и фактические условия на месте не проверены.", "Данные входа, полного пути без ступеней и окон во двор остаются неизвестными."];
  }
  // Research-level date is a collection summary, never used to refresh old rooms.
  output.latestCollectionAt = snapshots.map(s => s.obtainedAt).sort().at(-1);
  output.collectionMethod = "Bounded explicit HTTPS fetch; category-scoped HTML parser; immutable projection cache and source hashes.";
  return output;
}
async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const f of flags) if (!["--fetch", "--refresh"].includes(f)) throw new Error(`Unknown flag ${f}`);
  const online = flags.has("--fetch") || flags.has("--refresh");
  await mkdir(CACHE, { recursive: true });
  let index: Record<string, string> = {};
  try { index = JSON.parse(await readFile(`${CACHE}/index.json`, "utf8")); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  const snapshots: SourceSnapshot[] = [];
  const failures: { sourceId: string; url: string; reason: string }[] = [];
  for (const spec of SOURCES) {
    try {
      let snapshot: SourceSnapshot;
      if (index[spec.id] && !flags.has("--refresh")) snapshot = JSON.parse(await readFile(`${CACHE}/${index[spec.id]}`, "utf8"));
      else {
        if (!online) throw new Error("No cache; explicit --fetch is required");
        snapshot = await fetchSource(spec);
        const filename = `${spec.id}-${PARSER_VERSION}-${snapshot.responseSha256.slice(0, 16)}.json`;
        // Same body retains its original capture time; new bodies get new files.
        try { snapshot = JSON.parse(await readFile(`${CACHE}/${filename}`, "utf8")); }
        catch (e: any) { if (e.code !== "ENOENT") throw e; await writeFile(`${CACHE}/${filename}`, JSON.stringify(snapshot, null, 2) + "\n"); }
        index[spec.id] = filename;
        await writeFile(`${CACHE}/index.json`, JSON.stringify(index, null, 2) + "\n");
        await new Promise(r => setTimeout(r, 350));
      }
      validateSnapshot(spec, snapshot);
      snapshots.push(snapshot);
      console.log(`${spec.id}: cached/parsed ${snapshot.projection.name || "hotel policy"}`);
    } catch (e: any) {
      failures.push({ sourceId: spec.id, url: spec.url, reason: String(e.message).slice(0, 400) });
      // A failed refresh must not erase previously reviewed evidence or mint dates.
    }
  }
  const report = { checkedAt: new Date().toISOString(), parserVersion: PARSER_VERSION,
    mode: online ? "explicit_collection" : "offline_cache", expectedSources: SOURCES.length,
    successfulSources: snapshots.length, failures,
    caveats: ["Source agreement is not independent property verification.", "Courtyard and complete step-free access are not inferred from views, theme names, elevators or accessible bathrooms.", "Marriott JSON currently returned403 and Lotte returns a JavaScript shell to a direct GET; earlier reviewed records are preserved with their original dates, not silently refreshed."] };
  await writeFile("data/official-import-report.json", JSON.stringify(report, null, 2) + "\n");
  if (failures.length) throw new Error(`Collection incomplete (${failures.length}); research file not updated. See data/official-import-report.json`);
  const path = "data/verified-rooms-research.json";
  const research = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify(mergeSnapshots(research, snapshots), null, 2) + "\n");
  console.log(`Imported ${snapshots.filter(s => s.projection.name).length} actual categories with bounded provenance.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
