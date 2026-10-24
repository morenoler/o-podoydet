import type { Hotel } from "../../../shared/types";

export const lodgingLabels = {
  hotel: "Отель",
  motel: "Мотель",
  guest_house: "Гостевой дом",
  hostel: "Хостел",
  apartment: "Апартаменты",
};

export const lodgingLabel = (hotel: Hotel) =>
  lodgingLabels[hotel.lodgingType || "hotel"];
