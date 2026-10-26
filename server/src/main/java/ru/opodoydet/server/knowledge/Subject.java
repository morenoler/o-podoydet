package ru.opodoydet.server.knowledge;

/** О чём факт: характеристика отеля ({@code roomId == null}) или категории номера. */
public record Subject(String hotelId, String roomId, String characteristic) {

  public static Subject of(Evidence evidence) {
    return new Subject(evidence.getHotelId(), evidence.getRoomId(), evidence.getCharacteristic());
  }
}
