package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Запись новых доказательств. Доказательства только добавляются — история не переписывается. */
@Service
public class KnowledgeCommands {

  /** Что отельер сообщил о характеристике. */
  public record HostStatement(
      String hotelId,
      String roomId,
      String characteristic,
      JsonNode value,
      String quote,
      String confidenceLevel,
      String confidenceReason,
      String sourceName,
      boolean simulated,
      UUID questionId) {}

  private final JdbcClient jdbc;
  private final CharacteristicRepository characteristics;
  private final ObjectMapper json;
  private final Clock clock;

  KnowledgeCommands(
      JdbcClient jdbc, CharacteristicRepository characteristics, ObjectMapper json, Clock clock) {
    this.jdbc = jdbc;
    this.characteristics = characteristics;
    this.json = json;
    this.clock = clock;
  }

  /** Сохраняет ответ отельера как доказательство с методом host. Возвращает id доказательства. */
  @Transactional
  public String recordHostStatement(HostStatement s) {
    Characteristic c =
        characteristics
            .findById(s.characteristic())
            .orElseThrow(() -> new IllegalArgumentException("Неизвестная характеристика"));
    Instant now = clock.instant();
    Instant expires = now.plus(c.getTtlDays(), ChronoUnit.DAYS);
    String id = "host-" + UUID.randomUUID();

    ObjectNode raw = json.createObjectNode();
    raw.put("id", id);
    raw.put("hotelId", s.hotelId());
    if (s.roomId() != null) raw.put("roomId", s.roomId());
    raw.put("feature", s.characteristic());
    raw.set("value", s.value());
    raw.put("source", s.sourceName());
    raw.put("quote", s.quote());
    raw.put("method", "host");
    raw.put("confidence", s.confidenceLevel());
    raw.put("confidenceReason", s.confidenceReason());
    raw.put("obtainedAt", now.toString());
    raw.put("expiresAt", expires.toString());
    raw.put("demo", false);
    raw.put("simulated", s.simulated());

    jdbc.sql(
            """
            INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method, source_name,
              quote, confidence_level, confidence_reason, obtained_at, expires_at, demo, origin,
              active, simulated, question_id, raw)
            VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'host', ?, ?, ?, ?, ?, ?, FALSE, 'host', TRUE, ?, ?, ?)
            """)
        .params(
            id,
            s.hotelId(),
            s.roomId(),
            s.characteristic(),
            s.value() == null ? null : s.value().toString(),
            s.sourceName(),
            s.quote(),
            s.confidenceLevel(),
            s.confidenceReason(),
            Timestamp.from(now),
            Timestamp.from(expires),
            s.simulated(),
            s.questionId(),
            raw.toString())
        .update();
    // Отельер уточнил сам себя: прежний его ответ по этому же предмету больше не действует,
    // но остаётся в истории со ссылкой на замену.
    jdbc.sql(
            """
            UPDATE evidence SET superseded_by = ?
            WHERE id <> ? AND active AND superseded_by IS NULL AND method = 'host'
              AND hotel_id = ? AND room_id IS NOT DISTINCT FROM ? AND characteristic = ?
            """)
        .params(id, id, s.hotelId(), s.roomId(), s.characteristic())
        .update();
    return id;
  }
}
