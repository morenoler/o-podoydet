import type {
  ListingClarification,
  OwnerStatement,
} from "../../../shared/clarifications";

/** Date-only source dates stay dates; instants are displayed in the property's timezone. */
export function clarificationDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00+09:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Seoul",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/\s?г\.$/, "");
}

export function plannedRecheckDate(
  observedOn: string | null,
  validForDays: number,
  recordedDay: string,
) {
  const date = new Date(`${observedOn || recordedDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + validForDays);
  return date.toISOString().slice(0, 10);
}

export function correctableStatements(
  question: ListingClarification,
): OwnerStatement[] {
  return (question.relatedStatements || []).filter(
    (statement) =>
      statement.feature === question.feature &&
      statement.scopeId === question.listingId &&
      (statement.state === "active" || statement.state === "stale") &&
      statement.id !== question.answer?.id,
  );
}

export function clarificationNeedsAttention(question: ListingClarification) {
  return (
    question.status === "open" ||
    question.scopeChanged ||
    ["unknown", "stale", "conflict"].includes(question.evidenceStatus)
  );
}

export function clarificationStatusLabel(question: ListingClarification) {
  if (question.scopeChanged) return "Объявление изменилось";
  if (question.evidenceStatus === "conflict") return "Есть противоречия";
  if (question.evidenceStatus === "stale") return "Пора перепроверить";
  if (question.evidenceStatus === "mismatch") return "Не подходит по условию";
  if (question.evidenceStatus === "match") return "Условие заявлено владельцем";
  return question.status === "open"
    ? "Ожидает ответа"
    : "Условие пока неизвестно";
}
