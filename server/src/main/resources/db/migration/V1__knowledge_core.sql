-- Ядро знаний «О!Подойдёт».
--
-- Идея: мы храним не «поля отеля», а доказательства (evidence) — кто, когда, каким методом и
-- с какой уверенностью что-то утверждал. Итоговый факт (fact) — вычисляемая проекция из
-- доказательств; его всегда можно раскрыть до цепочки источников.
--
-- PostGIS подключим отдельной миграцией вместе с первыми геозапросами; координаты пока
-- хранятся как lon/lat, чтобы схема поднималась и на чистом PostgreSQL.

CREATE SEQUENCE catalog_ord_seq;

-- Метаданные набора данных региона (attribution, bbox, map и т. п.) в исходном виде.
CREATE TABLE dataset (
    region           TEXT PRIMARY KEY,
    body             TEXT        NOT NULL,
    evidence_policy  TEXT        NOT NULL CHECK (evidence_policy IN ('verified-only', 'demo')),
    imported_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE hotel (
    id            TEXT PRIMARY KEY,
    region        TEXT    NOT NULL REFERENCES dataset (region),
    ord           BIGINT  NOT NULL DEFAULT nextval('catalog_ord_seq'),
    name          TEXT    NOT NULL,
    lodging_type  TEXT,
    lon           DOUBLE PRECISION,
    lat           DOUBLE PRECISION,
    body          TEXT    NOT NULL, -- исходная карточка без rooms, ровно как пришла из источника
    active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX hotel_region_ord ON hotel (region, ord) WHERE active;

CREATE TABLE room (
    hotel_id  TEXT    NOT NULL REFERENCES hotel (id),
    id        TEXT    NOT NULL,
    ord       BIGINT  NOT NULL DEFAULT nextval('catalog_ord_seq'),
    name      TEXT,
    capacity  INTEGER CHECK (capacity BETWEEN 1 AND 20),
    body      TEXT    NOT NULL,
    active    BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (hotel_id, id)
);

-- Реестр характеристик: добавить характеристику = добавить строку, без переписывания кода.
CREATE TABLE characteristic (
    code        TEXT PRIMARY KEY,
    label       TEXT    NOT NULL,
    scope       TEXT    NOT NULL CHECK (scope IN ('hotel', 'room')),
    tool        TEXT    NOT NULL, -- route | host | area | ...
    value_type  TEXT    NOT NULL CHECK (value_type IN ('boolean', 'meters', 'assessment')),
    question    TEXT,
    positive    TEXT,
    negative    TEXT,
    threshold   INTEGER,
    ttl_days    INTEGER NOT NULL DEFAULT 30 CHECK (ttl_days > 0),
    spec        JSONB   NOT NULL DEFAULT '{}'::jsonb -- план сбора, валидация и т. п. (следующие шаги)
);

-- Априорное доверие к методу получения: официальный сайт надёжнее имитированного ответа.
CREATE TABLE source_method (
    method       TEXT PRIMARY KEY,
    prior_trust  NUMERIC(4, 3) NOT NULL CHECK (prior_trust BETWEEN 0 AND 1),
    description  TEXT          NOT NULL
);
INSERT INTO source_method (method, prior_trust, description) VALUES
    ('official', 0.900, 'Официальный сайт или документ отеля'),
    ('geo',      0.800, 'Расчёт по открытым геоданным'),
    ('host',     0.700, 'Ответ отельера'),
    ('agent',    0.500, 'Вывод агента по открытым источникам'),
    ('demo',     0.000, 'Демонстрационные данные: не участвуют в подборе');

CREATE TABLE evidence (
    id                 TEXT PRIMARY KEY,
    ord                BIGINT      NOT NULL DEFAULT nextval('catalog_ord_seq'),
    hotel_id           TEXT        NOT NULL REFERENCES hotel (id),
    room_id            TEXT,
    characteristic     TEXT        NOT NULL REFERENCES characteristic (code),
    value              JSONB,      -- NULL = источник есть, но значение не установлено
    method             TEXT        NOT NULL REFERENCES source_method (method),
    source_name        TEXT,
    source_url         TEXT,
    quote              TEXT,
    confidence_level   TEXT CHECK (confidence_level IN ('low', 'medium', 'high')),
    confidence_reason  TEXT,
    obtained_at        TIMESTAMPTZ,
    source_date        TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    demo               BOOLEAN     NOT NULL,
    origin             TEXT        NOT NULL CHECK (origin IN ('seed', 'host', 'agent')),
    active             BOOLEAN     NOT NULL DEFAULT TRUE,
    superseded_by      TEXT REFERENCES evidence (id),
    raw                TEXT        NOT NULL, -- исходная запись источника без изменений
    FOREIGN KEY (hotel_id, room_id) REFERENCES room (hotel_id, id)
);
CREATE INDEX evidence_subject ON evidence (hotel_id, room_id, characteristic) WHERE active;

-- Итоговые факты: проекция доказательств, пересчитывается FactResolver.
CREATE TABLE fact (
    id              BIGSERIAL PRIMARY KEY,
    hotel_id        TEXT          NOT NULL REFERENCES hotel (id),
    room_id         TEXT,
    room_key        TEXT GENERATED ALWAYS AS (COALESCE(room_id, '')) STORED,
    characteristic  TEXT          NOT NULL REFERENCES characteristic (code),
    value           JSONB,
    status          TEXT          NOT NULL CHECK (status IN ('confirmed', 'conflict', 'stale', 'unknown')),
    confidence      NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence_ids    TEXT[]        NOT NULL,
    valid_until     TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ   NOT NULL,
    UNIQUE (hotel_id, room_key, characteristic)
);

CREATE TABLE conflict (
    id              BIGSERIAL PRIMARY KEY,
    hotel_id        TEXT        NOT NULL REFERENCES hotel (id),
    room_id         TEXT,
    characteristic  TEXT        NOT NULL REFERENCES characteristic (code),
    evidence_ids    TEXT[]      NOT NULL,
    reason          TEXT        NOT NULL,
    detected_at     TIMESTAMPTZ NOT NULL,
    resolved_at     TIMESTAMPTZ,
    resolution      TEXT
);
CREATE INDEX conflict_open ON conflict (hotel_id, characteristic) WHERE resolved_at IS NULL;
