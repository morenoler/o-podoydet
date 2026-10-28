package ru.opodoydet.domain;

import java.time.ZoneId;
import java.util.Map;
import java.util.Locale;

/** Regional conventions; historical amounts and timestamps are never converted with this map. */
public record RegionSettings(String currency, ZoneId timezone) {
  private static final RegionSettings BUSAN = new RegionSettings("KRW", ZoneId.of("Asia/Seoul"));
  private static final Map<String, RegionSettings> KNOWN = Map.of(
      "пусан", BUSAN, "сочи", new RegionSettings("RUB", ZoneId.of("Europe/Moscow")));

  public static RegionSettings of(String region) {
    // Isolated legacy/demo datasets retain their previous conventions.
    return KNOWN.getOrDefault(region == null ? "" : region.strip().toLowerCase(Locale.ROOT), BUSAN);
  }
}
