package ru.opodoydet.server.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Метаданные набора данных региона в исходном виде (attribution, bbox, слой карты и т. п.). */
@Entity
@Table(name = "dataset")
public class Dataset {

  @Id private String region;

  @Column(nullable = false)
  private String body;

  @Column(name = "evidence_policy", nullable = false)
  private String evidencePolicy;

  @Column(name = "imported_at", nullable = false)
  private Instant importedAt;

  protected Dataset() {}

  public String getRegion() {
    return region;
  }

  public String getBody() {
    return body;
  }

  public String getEvidencePolicy() {
    return evidencePolicy;
  }

  public boolean isDemoPolicy() {
    return "demo".equals(evidencePolicy);
  }

  public Instant getImportedAt() {
    return importedAt;
  }
}
