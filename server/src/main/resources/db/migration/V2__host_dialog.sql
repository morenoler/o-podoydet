-- Диалог с отельером: агент сам задаёт вопросы по пробелам в знаниях,
-- а свободный ответ раскладывается в доказательства с методом host.

-- Ответ имитированного отельера (ТЗ это разрешает) честно помечается в данных.
ALTER TABLE evidence ADD COLUMN simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE host_question (
    id              UUID PRIMARY KEY,
    hotel_id        TEXT          NOT NULL REFERENCES hotel (id),
    room_id         TEXT,
    characteristic  TEXT          NOT NULL REFERENCES characteristic (code),
    text            TEXT          NOT NULL,
    -- Почему спросили: статус факта и ссылки на доказательства на момент вопроса.
    reason          TEXT          NOT NULL,
    trigger_status  TEXT          NOT NULL CHECK (trigger_status IN ('unknown', 'stale', 'conflict')),
    -- Ценность информации: чем выше, тем раньше вопрос показывается отельеру.
    priority        NUMERIC(4, 3) NOT NULL CHECK (priority BETWEEN 0 AND 1),
    status          TEXT          NOT NULL CHECK (status IN ('open', 'answered', 'unresolved', 'cancelled')),
    created_at      TIMESTAMPTZ   NOT NULL,
    answered_at     TIMESTAMPTZ,
    answer_text     TEXT,
    answer_channel  TEXT CHECK (answer_channel IN ('cabinet', 'simulated')),
    extractor       TEXT,
    FOREIGN KEY (hotel_id, room_id) REFERENCES room (hotel_id, id)
);

-- Не больше одного открытого вопроса по одному предмету.
CREATE UNIQUE INDEX host_question_one_open
    ON host_question (hotel_id, COALESCE(room_id, ''), characteristic)
    WHERE status = 'open';
CREATE INDEX host_question_queue ON host_question (status, priority DESC, created_at);

ALTER TABLE evidence ADD COLUMN question_id UUID REFERENCES host_question (id);
