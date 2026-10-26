package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Одно доказательство: кто, когда, каким методом и с какой уверенностью утверждал значение
 * характеристики. Доказательства не редактируются — новое знание добавляется новой записью, а
 * старая помечается {@code supersededBy}. Так история «почему мы так думаем» не теряется.
 */
@Entity
@Table(name = "evidence")
public class Evidence {

  @Id private String id;

  @Column(nullable = false, insertable = false, updatable = false)
  private long ord;

  @Column(name = "hotel_id", nullable = false)
  private String hotelId;

  @Column(name = "room_id")
  private String roomId;

  @Column(nullable = false)
  private String characteristic;

  /** {@code null} — источник есть, но значение он не устанавливает (частичные сведения). */
  @JdbcTypeCode(SqlTypes.JSON)
  private JsonNode value;

  /** official | geo | host | agent | demo */
  @Column(nullable = false)
  private String method;

  @Column(name = "source_name")
  private String sourceName;

  @Column(name = "source_url")
  private String sourceUrl;

  private String quote;

  /** low | medium | high — как оценил сам источник или сборщик. */
  @Column(name = "confidence_level")
  private String confidenceLevel;

  @Column(name = "confidence_reason")
  private String confidenceReason;

  @Column(name = "obtained_at")
  private Instant obtainedAt;

  @Column(name = "source_date")
  private Instant sourceDate;

  @Column(name = "expires_at")
  private Instant expiresAt;

  @Column(nullable = false)
  private boolean demo;

  /** seed | host | agent — откуда запись попала в систему. */
  @Column(nullable = false)
  private String origin;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "superseded_by")
  private String supersededBy;

  /** Ответ имитированного отельера (разрешено ТЗ) — помечается честно. */
  @Column(nullable = false)
  private boolean simulated;

  /** Вопрос отельеру, на который это доказательство — ответ. */
  @Column(name = "question_id")
  private java.util.UUID questionId;

  /** Исходная запись источника — для ответов в старом формате и аудита. */
  @Column(nullable = false)
  private String raw;

  protected Evidence() {}

  /** Для тестов резолвера: доказательство без БД. */
  static Evidence of(
      String id,
      String characteristic,
      JsonNode value,
      String method,
      String sourceUrl,
      String confidenceLevel,
      Instant obtainedAt,
      Instant expiresAt,
      boolean demo) {
    Evidence e = new Evidence();
    e.id = id;
    e.hotelId = "hotel";
    e.characteristic = characteristic;
    e.value = value;
    e.method = method;
    e.sourceUrl = sourceUrl;
    e.quote = "цитата из источника";
    e.confidenceLevel = confidenceLevel;
    e.obtainedAt = obtainedAt;
    e.expiresAt = expiresAt;
    e.demo = demo;
    e.origin = "seed";
    e.active = true;
    e.raw = "{}";
    return e;
  }

  public boolean isCurrent() {
    return active && supersededBy == null;
  }

  public boolean isExpired(Instant now) {
    return expiresAt != null && !expiresAt.isAfter(now);
  }

  public String getId() {
    return id;
  }

  public long getOrd() {
    return ord;
  }

  public String getHotelId() {
    return hotelId;
  }

  public String getRoomId() {
    return roomId;
  }

  public String getCharacteristic() {
    return characteristic;
  }

  public JsonNode getValue() {
    return value;
  }

  public String getMethod() {
    return method;
  }

  public String getSourceName() {
    return sourceName;
  }

  public String getSourceUrl() {
    return sourceUrl;
  }

  public String getQuote() {
    return quote;
  }

  public String getConfidenceLevel() {
    return confidenceLevel;
  }

  public String getConfidenceReason() {
    return confidenceReason;
  }

  public Instant getObtainedAt() {
    return obtainedAt;
  }

  public Instant getSourceDate() {
    return sourceDate;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  public boolean isDemo() {
    return demo;
  }

  public String getOrigin() {
    return origin;
  }

  public boolean isActive() {
    return active;
  }

  public String getSupersededBy() {
    return supersededBy;
  }

  public boolean isSimulated() {
    return simulated;
  }

  public java.util.UUID getQuestionId() {
    return questionId;
  }

  public String getRaw() {
    return raw;
  }
}
