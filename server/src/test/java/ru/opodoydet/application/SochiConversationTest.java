package ru.opodoydet.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class SochiConversationTest {
  @Test void budgetUsesOnlyTheSelectedRegionsCurrency() {
    for (String message : List.of("до 5 тыс. рублей", "бюджет до 5000 RUB", "до 5000 ₽"))
      assertThat(SearchConversation.rules(message, List.of(), "Сочи").path("hotelFilters").path("maxPricePerNight").asDouble()).isEqualTo(5000);
    assertThat(SearchConversation.rules("до 5000 KRW", List.of(), "Сочи").path("hotelFilters").has("maxPricePerNight")).isFalse();
    assertThat(SearchConversation.rules("до 5000 рублей", List.of(), "Пусан").path("hotelFilters").has("maxPricePerNight")).isFalse();
  }

  @Test void sochiConversationDoesNotNameBusansCenterOrCurrency() {
    var trip = Json.obj("region", "Сочи", "checkIn", "", "checkOut", "", "text", "", "preferences", List.of());
    var result = new SearchConversation(null).refine(trip, "в центре города; до 5000 рублей", Json.MAPPER.missingNode());
    assertThat(result.path("trip").path("hotelFilters").path("maxPricePerNight").asInt()).isEqualTo(5000);
    assertThat(Json.write(result)).contains("RUB", "Сочи").doesNotContain("KRW", "Сомён", "Seomyeon");
    assertThat(NearbyIntent.parse("рядом с seomyeon", "Сочи").updates()).isEmpty();
  }
}
