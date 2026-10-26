package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Итоговое знание о характеристике — проекция доказательств, которую строит {@link FactResolver}. */
@Entity
@Table(name = "fact")
public class Fact {

  public enum Status {
    /** Свежие допустимые доказательства согласны между собой. */
    confirmed,
    /** Свежие доказательства противоречат друг другу — см. таблицу conflict. */
    conflict,
    /** Доказательства есть, но все устарели — нужна перепроверка. */
    stale,
    /** Допустимых доказательств со значением нет. */
    unknown
  }

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "hotel_id", nullable = false)
  private String hotelId;

  @Column(name = "room_id")
  private String roomId;

  @Column(nullable = false)
  private String characteristic;

  @JdbcTypeCode(SqlTypes.JSON)
  private JsonNode value;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private Status status;

  @Column(nullable = false, precision = 4, scale = 3)
  private BigDecimal confidence;

  @JdbcTypeCode(SqlTypes.ARRAY)
  @Column(name = "evidence_ids", nullable = false)
  private String[] evidenceIds;

  @Column(name = "valid_until")
  private Instant validUntil;

  @Column(name = "resolved_at", nullable = false)
  private Instant resolvedAt;

  protected Fact() {}

  Fact(Subject subject) {
    this.hotelId = subject.hotelId();
    this.roomId = subject.roomId();
    this.characteristic = subject.characteristic();
  }

  void update(
      JsonNode value,
      Status status,
      double confidence,
      List<String> evidenceIds,
      Instant validUntil,
      Instant resolvedAt) {
    this.value = value;
    this.status = status;
    this.confidence = BigDecimal.valueOf(confidence).setScale(3, RoundingMode.HALF_UP);
    this.evidenceIds = evidenceIds.toArray(String[]::new);
    this.validUntil = validUntil;
    this.resolvedAt = resolvedAt;
  }

  public Subject subject() {
    return new Subject(hotelId, roomId, characteristic);
  }

  public Long getId() {
    return id;
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

  public Status getStatus() {
    return status;
  }

  public BigDecimal getConfidence() {
    return confidence;
  }

  public List<String> getEvidenceIds() {
    return List.of(evidenceIds);
  }

  public Instant getValidUntil() {
    return validUntil;
  }

  public Instant getResolvedAt() {
    return resolvedAt;
  }
}
