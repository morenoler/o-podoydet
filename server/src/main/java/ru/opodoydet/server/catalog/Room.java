package ru.opodoydet.server.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;

@Entity
@Table(name = "room")
@IdClass(Room.Key.class)
public class Room {

  public record Key(String hotelId, String id) implements Serializable {
    public Key() {
      this(null, null);
    }
  }

  @Id
  @Column(name = "hotel_id")
  private String hotelId;

  @Id private String id;

  @Column(nullable = false, insertable = false, updatable = false)
  private long ord;

  private String name;
  private Integer capacity;

  @Column(nullable = false)
  private String body;

  @Column(nullable = false)
  private boolean active;

  protected Room() {}

  public String getHotelId() {
    return hotelId;
  }

  public String getId() {
    return id;
  }

  public long getOrd() {
    return ord;
  }

  public String getName() {
    return name;
  }

  public Integer getCapacity() {
    return capacity;
  }

  public String getBody() {
    return body;
  }

  public boolean isActive() {
    return active;
  }
}
