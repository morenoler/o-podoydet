package ru.opodoydet.server.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.SQLRestriction;

@Entity
@Table(name = "hotel")
public class Hotel {

  @Id private String id;

  @Column(nullable = false)
  private String region;

  @Column(nullable = false, insertable = false, updatable = false)
  private long ord;

  @Column(nullable = false)
  private String name;

  @Column(name = "lodging_type")
  private String lodgingType;

  private Double lon;
  private Double lat;

  /** Исходная карточка без rooms — из неё собирается ответ в старом формате. */
  @Column(nullable = false)
  private String body;

  @Column(nullable = false)
  private boolean active;

  // Только чтение: каталог пишет SeedImporter напрямую через SQL (идемпотентный upsert).
  @OneToMany
  @JoinColumn(name = "hotel_id", insertable = false, updatable = false)
  @SQLRestriction("active")
  @OrderBy("ord")
  private List<Room> rooms = new ArrayList<>();

  protected Hotel() {}

  public String getId() {
    return id;
  }

  public String getRegion() {
    return region;
  }

  public long getOrd() {
    return ord;
  }

  public String getName() {
    return name;
  }

  public String getLodgingType() {
    return lodgingType;
  }

  public Double getLon() {
    return lon;
  }

  public Double getLat() {
    return lat;
  }

  public String getBody() {
    return body;
  }

  public boolean isActive() {
    return active;
  }

  public List<Room> getRooms() {
    return rooms;
  }
}
