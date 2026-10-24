import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Dataset, Draft, Fact, Question } from "../shared/types";
import { extractionSchema } from "../shared/validation";

export class Store {
  db: DatabaseSync;
  constructor(path: string, seed: Dataset) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,scope TEXT UNIQUE,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,body TEXT NOT NULL);",
    );
    const statement = this.db.prepare(
      "INSERT OR IGNORE INTO facts VALUES (?,?)",
    );
    for (const f of seed.facts) statement.run(f.id, JSON.stringify(f));
  }
  facts(): Fact[] {
    return this.db
      .prepare("SELECT body FROM facts")
      .all()
      .map((x) => JSON.parse(x.body as string));
  }
  questions(): Question[] {
    return this.db
      .prepare("SELECT body FROM questions ORDER BY rowid DESC")
      .all()
      .map((x) => JSON.parse(x.body as string));
  }
  question(id: string) {
    return this.questions().find((q) => q.id === id);
  }
  ask(question: Omit<Question, "id" | "createdAt" | "status">): Question {
    const scope = `${question.hotelId}:${question.roomId}:${question.feature}`;
    const row = this.db
      .prepare("SELECT body FROM questions WHERE scope=?")
      .get(scope);
    if (row) {
      const existing = JSON.parse(row.body as string) as Question;
      if (existing.status === "open") return existing;
      const reopened: Question = {
        ...existing,
        text: question.text,
        status: "open",
        answer: undefined,
        createdAt: new Date().toISOString(),
        trace: question.trace,
      };
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "DELETE FROM drafts WHERE json_extract(body, '$.questionId')=?",
          )
          .run(existing.id);
        this.db
          .prepare("UPDATE questions SET body=? WHERE id=?")
          .run(JSON.stringify(reopened), existing.id);
        this.db.exec("COMMIT");
        return reopened;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const q: Question = {
      ...question,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "open",
    };
    this.db
      .prepare("INSERT INTO questions VALUES (?,?,?)")
      .run(q.id, scope, JSON.stringify(q));
    return q;
  }
  draft(draft: Draft) {
    const question = this.question(draft.questionId);
    if (!question || question.status !== "open")
      throw new Error("Открытый вопрос не найден.");
    if (draft.extractions.length > 1)
      throw new Error(
        "Ответ должен описывать одно условие выбранной категории.",
      );
    for (const raw of draft.extractions) {
      const e = extractionSchema.parse(raw);
      if (e.feature !== question.feature || !draft.text.includes(e.quote))
        throw new Error("Извлечённый факт не подтверждён исходным ответом.");
    }
    this.db
      .prepare("INSERT INTO drafts VALUES (?,?)")
      .run(draft.id, JSON.stringify(draft));
  }
  getDraft(id: string): Draft | undefined {
    const row = this.db.prepare("SELECT body FROM drafts WHERE id=?").get(id);
    return row ? JSON.parse(row.body as string) : undefined;
  }
  confirm(draftId: string, resolve: boolean): Fact[] {
    const draft = this.getDraft(draftId);
    if (!draft) throw new Error("Черновик уже сохранён или не найден.");
    const q = this.question(draft.questionId);
    if (!q || q.status !== "open")
      throw new Error("Вопрос уже закрыт. Создайте новое уточнение.");
    if (!draft.extractions.length)
      throw new Error(
        "Сначала уточните ответ, чтобы получить однозначный факт.",
      );
    const now = new Date().toISOString();
    const output: Fact[] = draft.extractions.map((e) => ({
      id: randomUUID(),
      hotelId: q.hotelId,
      roomId: q.roomId,
      feature: e.feature,
      value: e.value,
      source: "Ответ в демонстрационном кабинете отельера",
      quote: e.quote,
      method: "host",
      confidence: "low",
      confidenceReason:
        "Имитированный ответ, подтверждённый оператором демонстрации. Не подтверждение реального отеля.",
      obtainedAt: now,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      demo: true,
    }));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const fact of output) {
        if (resolve)
          for (const old of this.facts().filter(
            (f) =>
              !f.supersededBy &&
              f.hotelId === fact.hotelId &&
              f.roomId === fact.roomId &&
              f.feature === fact.feature,
          ))
            this.db
              .prepare("UPDATE facts SET body=? WHERE id=?")
              .run(JSON.stringify({ ...old, supersededBy: fact.id }), old.id);
        this.db
          .prepare("INSERT INTO facts VALUES (?,?)")
          .run(fact.id, JSON.stringify(fact));
      }
      this.db
        .prepare("UPDATE questions SET body=? WHERE id=?")
        .run(
          JSON.stringify({ ...q, status: "answered", answer: draft.text }),
          q.id,
        );
      // Other previews of the same answer must not survive a later reopening.
      this.db
        .prepare(
          "DELETE FROM drafts WHERE json_extract(body, '$.questionId')=?",
        )
        .run(q.id);
      this.db.exec("COMMIT");
      return output;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
