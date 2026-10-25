import assert from "node:assert/strict";
import {
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const previewPath = resolve(root, "data/demo/preview.sqlite3");
export const localDemoPath = resolve(root, ".local/demo.sqlite3");
const fixturePath = resolve(root, "data/demo/fixtures.json");
const marker = "opodoydet-synthetic-demo-v1";
const millisecondsPerDay = 86_400_000;

export function demoToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function dateAfter(base, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || !Number.isInteger(days))
    throw new Error("Дата должна иметь формат YYYY-MM-DD.");
  const date = new Date(`${base}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== base)
    throw new Error("Некорректная календарная дата.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function targetPath(path) {
  const target = resolve(root, path);
  const within = relative(root, target).replaceAll("\\", "/");
  if (
    isAbsolute(within) ||
    within.startsWith("../") ||
    !(
      within.startsWith("data/demo/") ||
      within.startsWith(".local/demo-") ||
      within.startsWith(".local/demo/") ||
      within === ".local/demo.sqlite3"
    )
  ) {
    throw new Error(
      "Демо-база должна находиться в data/demo/ или .local/demo*. Основные базы недоступны этому скрипту.",
    );
  }
  return target;
}

function ensureNew(path) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(path + suffix))
      throw new Error(
        `База или её служебный файл уже существует: ${relative(root, path + suffix)}. Перезапись запрещена.`,
      );
  }
  mkdirSync(dirname(path), { recursive: true });
}

/** Matches Java Passwords: PBKDF2-HMAC-SHA256, 600000 iterations, 16-byte salt, 256-bit result. */
function hashPassword(password) {
  const salt = randomBytes(16);
  return `600000:${salt.toString("base64")}:${pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("base64")}`;
}

function checkPassword(password, encoded) {
  const [iterations, salt, digest] = encoded.split(":");
  const expected = Buffer.from(digest, "base64");
  assert.equal(Number(iterations), 600000);
  assert.equal(Buffer.from(salt, "base64").length, 16);
  assert.equal(expected.length, 32);
  return timingSafeEqual(
    expected,
    pbkdf2Sync(
      password,
      Buffer.from(salt, "base64"),
      Number(iterations),
      32,
      "sha256",
    ),
  );
}

function metadata(db, key) {
  return db.prepare("SELECT value FROM demo_seed_metadata WHERE key=?").get(key)
    ?.value;
}

export function assertDemoMarker(db) {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_seed_metadata'",
    )
    .get();
  if (!table || metadata(db, "kind") !== marker)
    throw new Error(
      "Это не отдельная синтетическая демо-база. Запуск отменён.",
    );
}

export function validateDemoDatabase(path, { strict = true } = {}) {
  if (
    !existsSync(path) ||
    !lstatSync(path).isFile() ||
    lstatSync(path).isSymbolicLink()
  )
    throw new Error("Демо-база отсутствует или не является обычным файлом.");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assertDemoMarker(db);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const counts = {};
    for (const table of [
      "account_users",
      "account_sessions",
      "account_listings",
      "account_bookings",
      "account_questions",
      "account_listing_search_profiles",
      "account_uploaded_photos",
      "advisor_runs",
      "questions",
      "drafts",
    ])
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    if (strict) {
      assert.deepEqual(counts, {
        account_users: 2,
        account_sessions: 0,
        account_listings: 4,
        account_bookings: 6,
        account_questions: 6,
        account_listing_search_profiles: 4,
        account_uploaded_photos: 0,
        advisor_runs: 0,
        questions: 0,
        drafts: 0,
      });
      const expected = JSON.parse(readFileSync(fixturePath, "utf8"));
      assert.equal(
        metadata(db, "fixtureSha256"),
        createHash("sha256").update(JSON.stringify(expected)).digest("hex"),
        "Образец не соответствует текущим синтетическим фикстурам. Создайте новый файл генератором.",
      );
      for (const account of expected.accounts) {
        const row = db
          .prepare(
            "SELECT password_hash,role,phone FROM account_users WHERE id=? AND email=?",
          )
          .get(account.id, account.email);
        assert.ok(row, "Синтетический аккаунт отсутствует");
        assert.equal(row.role, account.role);
        assert.equal(row.phone, "");
        assert.ok(
          checkPassword(account.password, row.password_hash),
          "Пароль не соответствует протоколу Java",
        );
      }
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_listings WHERE status='published'",
          )
          .get().n,
        3,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_listings WHERE status='draft'",
          )
          .get().n,
        1,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_listings WHERE photos<>'[]'",
          )
          .get().n,
        0,
      );
      const statuses = Object.fromEntries(
        db
          .prepare(
            "SELECT status,COUNT(*) AS n FROM account_bookings GROUP BY status",
          )
          .all()
          .map((row) => [row.status, row.n]),
      );
      assert.deepEqual(statuses, {
        cancelled: 1,
        completed: 2,
        confirmed: 1,
        pending: 2,
      });
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_questions WHERE answer IS NULL",
          )
          .get().n,
        3,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_questions WHERE answer IS NOT NULL AND answered_at IS NOT NULL",
          )
          .get().n,
        3,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_bookings WHERE total_price<>nights*price_per_night OR julianday(check_out)-julianday(check_in)<>nights",
          )
          .get().n,
        0,
      );
      const seedDate = metadata(db, "seedDate");
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_bookings WHERE (status='completed' AND check_out>?) OR (status IN ('pending','confirmed') AND check_in<=?)",
          )
          .get(seedDate, seedDate).n,
        0,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hotels").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM facts").get().n, 0);
    }
    return { seedDate: metadata(db, "seedDate"), counts };
  } finally {
    db.close();
  }
}

export function seedDemoDatabase({
  output = previewPath,
  date = demoToday(),
} = {}) {
  dateAfter(date, 0);
  const target = targetPath(output);
  ensureNew(target);
  // Reserve exclusively before SQLite opens the file: existing databases are never overwritten.
  closeSync(openSync(target, "wx"));
  const db = new DatabaseSync(target);
  let completed = false;
  try {
    const source = readFileSync(fixturePath, "utf8");
    const fixtures = JSON.parse(source);
    db.exec(
      readFileSync(
        resolve(root, "backend/src/main/resources/schema.sql"),
        "utf8",
      ).replace(
        /PRAGMA journal_mode\s*=\s*WAL\s*;/i,
        "PRAGMA journal_mode=DELETE;",
      ),
    );
    db.exec(
      readFileSync(
        resolve(root, "backend/src/main/resources/accounts-schema.sql"),
        "utf8",
      ),
    );
    db.exec("BEGIN IMMEDIATE");
    // Same additive migration as AccountMigrations.public-listing-details-v2.
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(account_listings)")
        .all()
        .map((row) => row.name),
    );
    if (!columns.has("floor"))
      db.exec(
        "ALTER TABLE account_listings ADD COLUMN floor INTEGER CHECK(floor BETWEEN -3 AND 200)",
      );
    if (!columns.has("window_directions"))
      db.exec(
        "ALTER TABLE account_listings ADD COLUMN window_directions TEXT NOT NULL DEFAULT '[]'",
      );
    if (!columns.has("photos"))
      db.exec(
        "ALTER TABLE account_listings ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'",
      );
    const time = (days) => `${dateAfter(date, days)}T09:00:00.000Z`;
    db.prepare(
      "INSERT INTO account_migrations(name,applied_at) VALUES(?,?)",
    ).run("public-listing-details-v2", time(0));
    const user = fixtures.accounts.find((account) => account.role === "user");
    const host = fixtures.accounts.find((account) => account.role === "host");
    for (const account of fixtures.accounts)
      db.prepare(
        "INSERT INTO account_users(id,email,password_hash,role,name,phone,about,created_at) VALUES(?,?,?,?,?,'',?,?)",
      ).run(
        account.id,
        account.email,
        hashPassword(account.password),
        account.role,
        account.name,
        account.about,
        time(-150),
      );
    fixtures.listings.forEach((listing, index) => {
      db.prepare(
        "INSERT INTO account_listings(id,host_id,title,description,city,address,room_type,capacity,price_per_night,amenities,status,created_at,updated_at,floor,window_directions,photos) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        listing.id,
        host.id,
        listing.title,
        listing.description,
        listing.city,
        listing.address,
        listing.roomType,
        listing.capacity,
        listing.pricePerNight,
        JSON.stringify(listing.amenities),
        listing.status,
        time(-120 + index),
        time(-10 + index),
        listing.floor,
        JSON.stringify(listing.windowDirections),
        "[]",
      );
      db.prepare(
        "INSERT INTO account_listing_search_profiles(listing_id,notes) VALUES(?,?)",
      ).run(listing.id, listing.notes);
    });
    fixtures.bookings.forEach((booking, index) => {
      const listing = fixtures.listings[booking.listing];
      const nights = booking.checkOutDays - booking.checkInDays;
      db.prepare(
        "INSERT INTO account_bookings(id,listing_id,user_id,check_in,check_out,guests,nights,price_per_night,total_price,status,note,listing_title,city,address,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        `44444444-4444-4444-8444-44444444400${index + 1}`,
        listing.id,
        user.id,
        dateAfter(date, booking.checkInDays),
        dateAfter(date, booking.checkOutDays),
        booking.guests,
        nights,
        booking.pricePerNight,
        nights * booking.pricePerNight,
        booking.status,
        booking.note,
        listing.title,
        listing.city,
        listing.address,
        time(booking.createdDays),
        time(booking.updatedDays),
      );
    });
    fixtures.questions.forEach((question, index) =>
      db
        .prepare(
          "INSERT INTO account_questions(id,listing_id,user_id,text,answer,created_at,answered_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          `55555555-5555-4555-8555-55555555500${index + 1}`,
          fixtures.listings[question.listing].id,
          user.id,
          question.text,
          question.answer,
          time(question.createdDays),
          question.answer === null ? null : time(question.answeredDays),
        ),
    );
    db.exec(
      "CREATE TABLE demo_seed_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    for (const [key, value] of Object.entries({
      kind: marker,
      version: String(fixtures.version),
      seedDate: date,
      fixtureSha256: createHash("sha256")
        .update(JSON.stringify(fixtures))
        .digest("hex"),
      notice: fixtures.notice,
    }))
      db.prepare("INSERT INTO demo_seed_metadata(key,value) VALUES(?,?)").run(
        key,
        value,
      );
    db.exec("COMMIT");
    completed = true;
  } finally {
    db.close();
    if (!completed) unlinkSync(target);
  }
  return { path: target, ...validateDemoDatabase(target) };
}

export function setupDemoDatabase({
  source = previewPath,
  output = localDemoPath,
  date = demoToday(),
} = {}) {
  dateAfter(date, 0);
  const original = validateDemoDatabase(source);
  const target = targetPath(output);
  ensureNew(target);
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  const db = new DatabaseSync(target);
  let completed = false;
  try {
    // Only the newly created local copy is rebased, keeping future/past examples useful after cloning.
    const deltaDays = Math.round(
      (Date.parse(`${date}T12:00:00Z`) -
        Date.parse(`${original.seedDate}T12:00:00Z`)) /
        millisecondsPerDay,
    );
    const shift = (value) =>
      value === null
        ? null
        : value.length === 10
          ? dateAfter(value, deltaDays)
          : new Date(
              Date.parse(value) + deltaDays * millisecondsPerDay,
            ).toISOString();
    db.exec("BEGIN IMMEDIATE");
    for (const [table, columns] of Object.entries({
      account_users: ["created_at"],
      account_listings: ["created_at", "updated_at"],
      account_bookings: ["check_in", "check_out", "created_at", "updated_at"],
      account_questions: ["created_at", "answered_at"],
    })) {
      for (const row of db
        .prepare(`SELECT id,${columns.join(",")} FROM ${table}`)
        .all())
        db.prepare(
          `UPDATE ${table} SET ${columns.map((column) => `${column}=?`).join(",")} WHERE id=?`,
        ).run(...columns.map((column) => shift(row[column])), row.id);
    }
    db.prepare(
      "UPDATE demo_seed_metadata SET value=? WHERE key='seedDate'",
    ).run(date);
    db.prepare(
      "INSERT INTO demo_seed_metadata(key,value) VALUES('sourceSeedDate',?)",
    ).run(original.seedDate);
    db.exec("COMMIT");
    completed = true;
  } finally {
    db.close();
    if (!completed) unlinkSync(target);
  }
  return { path: target, ...validateDemoDatabase(target) };
}
