package ru.opodoydet.server.knowledge;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Зафиксированное противоречие между источниками. История не удаляется: только закрывается. */
@Entity
@Table(name = "conflict")
public class Conflict {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "hotel_id", nullable = false)
  private String hotelId;

  @Column(name = "room_id")
  private String roomId;

  @Column(nullable = false)
  private String characteristic;

  @JdbcTypeCode(SqlTypes.ARRAY)
  @Column(name = "evidence_ids", nullable = false)
  private String[] evidenceIds;

  @Column(nullable = false)
  private String reason;

  @Column(name = "detected_at", nullable = false)
  private Instant detectedAt;

  @Column(name = "resolved_at")
  private Instant resolvedAt;

  private String resolution;

  protected Conflict() {}

  Conflict(Subject subject, List<String> evidenceIds, String reason, Instant detectedAt) {
    this.hotelId = subject.hotelId();
    this.roomId = subject.roomId();
    this.characteristic = subject.characteristic();
    this.evidenceIds = evidenceIds.toArray(String[]::new);
    this.reason = reason;
    this.detectedAt = detectedAt;
  }

  void close(String resolution, Instant at) {
    this.resolution = resolution;
    this.resolvedAt = at;
  }

  boolean sameEvidence(List<String> ids) {
    return Set.of(evidenceIds).equals(Set.copyOf(ids));
  }

  public Subject subject() {
    return new Subject(hotelId, roomId, characteristic);
  }

  public Long getId() {
    return id;
  }

  public List<String> getEvidenceIds() {
    return List.of(evidenceIds);
  }

  public String getReason() {
    return reason;
  }

  public Instant getDetectedAt() {
    return detectedAt;
  }

  public Instant getResolvedAt() {
    return resolvedAt;
  }

  public String getResolution() {
    return resolution;
  }
}
