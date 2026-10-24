import express from "express";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store";
import { extractAnswer, interpretTrip, llmEnabled } from "./agents";
import { rankHotels, evaluate } from "../shared/matching";
import { tripSchema, featureSchema } from "../shared/validation";
import { features } from "../shared/features";
import type { Dataset, Draft, SearchResult } from "../shared/types";

export function createApp(dataset: Dataset, store: Store) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb" }));
  // This is a local single-user demo. Do not expose the host cabinet publicly.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.headers.origin) {
      let sameOrigin = false;
      try {
        const origin = new URL(req.headers.origin);
        sameOrigin =
          origin.host === req.headers.host &&
          ["http:", "https:"].includes(origin.protocol);
      } catch {
        /* Invalid origins are rejected too. */
      }
      if (!sameOrigin) {
        res
          .status(403)
          .json({ error: "Запрос должен быть отправлен из этого приложения." });
        return;
      }
    }
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      hotels: dataset.hotels.length,
      mode: llmEnabled() ? "llm" : "rules",
    }),
  );
  app.get("/api/catalog", (_req, res) =>
    res.json({
      ...dataset,
      facts: undefined,
      mode: llmEnabled() ? "llm" : "rules",
    }),
  );
  app.post("/api/search", async (req, res) => {
    const trip = tripSchema.parse(req.body);
    const interpreted = await interpretTrip(trip);
    const ranked = rankHotels(
      dataset.hotels,
      store.facts(),
      interpreted.preferences,
      trip,
    );
    const result: SearchResult = {
      ...interpreted,
      results: interpreted.conflicts.length
        ? []
        : ranked.filter((h) => h.best.status !== "excluded"),
      excluded: ranked.filter((h) => h.best.status === "excluded"),
      trace: [
        {
          step: "Запрос",
          detail: `${trip.region}, ${trip.checkIn} — ${trip.checkOut}. ${interpreted.preferences.length} пожеланий.`,
          tool: interpreted.mode === "llm" ? "structured LLM" : "local rules",
        },
        {
          step: "Поиск",
          detail: `Проверены ${dataset.hotels.length} отелей. Условия сопоставлены внутри одной категории номера.`,
          tool: "rankHotels",
        },
        {
          step: "Доказательства",
          detail:
            "Географические расчёты из локальной выгрузки; условия номеров — демонстрационные. Бронирование и цены не проверены.",
          tool: "SQLite",
        },
      ],
    };
    res.json(result);
  });
  app.get("/api/hotels/:id", (req, res) => {
    const hotel = dataset.hotels.find((h) => h.id === req.params.id);
    if (!hotel) {
      res.status(404).json({ error: "Отель не найден" });
      return;
    }
    res.json({
      hotel,
      facts: store.facts().filter((f) => f.hotelId === hotel.id),
      questions: store.questions().filter((q) => q.hotelId === hotel.id),
    });
  });
  app.get("/api/questions", (_req, res) => res.json(store.questions()));
  app.post("/api/questions", (req, res) => {
    const input = z
      .object({
        hotelId: z.string(),
        roomId: z.string(),
        feature: featureSchema,
        trip: tripSchema,
      })
      .parse(req.body);
    const hotel = dataset.hotels.find((h) => h.id === input.hotelId),
      room = hotel?.rooms.find((r) => r.id === input.roomId);
    if (!hotel || !room) {
      res.status(404).json({ error: "Категория номера не найдена" });
      return;
    }
    const definition = features[input.feature];
    const criterion = evaluate(
      store.facts().filter((f) => f.hotelId === hotel.id),
      { feature: input.feature, required: false },
      room,
      input.trip,
    );
    if (definition.tool === "route") {
      res.json({
        question: null,
        message: hotel.route
          ? "Маршрут рассчитан по сохранённой карте. Доступность всего пути требует обследования; отсутствие отметок не подтверждает отсутствие препятствий."
          : "Для этого отеля маршрут по сохранённой карте не найден. Геоданных недостаточно; расстояние и доступность пути остаются неизвестными.",
      });
      return;
    }
    const q = store.ask({
      hotelId: hotel.id,
      roomId: room.id,
      feature: input.feature,
      text: `${room.name}: ${definition.question}`,
      trace: [
        {
          step: "Проверка базы",
          detail: `Состояние характеристики: ${criterion.status}`,
          tool: "facts.lookup",
        },
        {
          step: "Выбор инструмента",
          detail:
            "Для условий внутри номера геоданных недостаточно. Выбран вопрос отельеру.",
          tool: "host.ask",
        },
        {
          step: "Вопрос",
          detail:
            "Привязан к конкретной категории. Повторный открытый вопрос не создаётся.",
        },
      ],
    });
    res.json({
      question: q,
      message: "Вопрос добавлен в демонстрационный кабинет отельера.",
    });
  });
  app.post("/api/questions/:id/preview", async (req, res) => {
    const { text } = z
      .object({ text: z.string().trim().min(3).max(1500) })
      .parse(req.body);
    const q = store.question(String(req.params.id));
    if (!q || q.status !== "open") {
      res.status(404).json({ error: "Открытый вопрос не найден" });
      return;
    }
    const result = await extractAnswer(text, q.feature);
    if (store.question(q.id)?.createdAt !== q.createdAt) {
      res
        .status(409)
        .json({
          error: "Вопрос был обновлён во время разбора. Откройте его заново.",
        });
      return;
    }
    const draft: Draft = {
      id: randomUUID(),
      questionId: q.id,
      text,
      ...result,
    };
    store.draft(draft);
    res.json(draft);
  });
  app.post("/api/drafts/:id/confirm", (req, res) => {
    const { resolveConflict } = z
      .object({ resolveConflict: z.boolean() })
      .parse(req.body);
    res.json({ facts: store.confirm(String(req.params.id), resolveConflict) });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Метод не найден" }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues.map((i) => i.message).join(". ") });
        return;
      }
      res
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Не удалось выполнить действие",
        });
    },
  );
  return app;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dataset = JSON.parse(readFileSync("data/demo.json", "utf8")) as Dataset;
  mkdirSync(".local", { recursive: true });
  const store = new Store(process.env.DB_PATH || ".local/app.sqlite", dataset);
  const app = createApp(dataset, store);
  if (process.argv.includes("--production")) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve("dist/index.html")),
    );
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`О!Подойдёт: http://127.0.0.1:${port}`),
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
