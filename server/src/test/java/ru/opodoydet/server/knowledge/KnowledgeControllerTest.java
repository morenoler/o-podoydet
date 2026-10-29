package ru.opodoydet.server.knowledge;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.node.BooleanNode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.host.DemoHostGuard;

class KnowledgeControllerTest {
  private static final Instant NOW = Instant.parse("2026-10-29T00:00:00Z");

  @Test void danglingEvidenceAndUnknownCharacteristicRemainVisibleWithoutConfirmingTheFact() {
    KnowledgeQueries queries = mock(KnowledgeQueries.class);
    CatalogService catalog = mock(CatalogService.class);
    when(catalog.hotelRegion("hotel")).thenReturn(Optional.of("Пусан"));
    Fact fact = new Fact(new Subject("hotel", null, "removed_characteristic"));
    fact.update(BooleanNode.TRUE, Fact.Status.confirmed, 0.8, List.of("existing", "missing"), NOW.plusSeconds(3600), NOW);
    Evidence evidence = Evidence.of("existing", "removed_characteristic", BooleanNode.TRUE,
        "official", "https://example.org", "high", NOW.minusSeconds(60), null, false);
    when(queries.facts("hotel")).thenReturn(List.of(fact));
    when(queries.characteristics()).thenReturn(List.of());
    when(queries.evidenceById(List.of("existing", "missing"))).thenReturn(Map.of("existing", evidence));
    when(queries.conflicts("hotel")).thenReturn(List.of());
    var controller = new KnowledgeController(queries, mock(FactResolver.class), Clock.fixed(NOW, ZoneOffset.UTC),
        mock(DemoHostGuard.class), catalog);
    var response = controller.hotel("hotel");
    assertEquals(200, response.getStatusCode().value());
    var view = ((KnowledgeController.HotelKnowledge) response.getBody()).facts().getFirst();
    assertEquals("removed_characteristic", view.label());
    assertEquals(Fact.Status.unknown, view.status());
    assertNull(view.value());
    assertEquals(0, view.confidence().signum());
    assertEquals(List.of("existing", "missing"), view.evidence().stream().map(KnowledgeController.EvidenceView::id).toList());
    assertTrue(view.evidence().stream().noneMatch(KnowledgeController.EvidenceView::admissible));
    assertTrue(view.evidence().get(1).confidenceReason().contains("отсутствует"));
    verify(queries, times(1)).characteristics();
  }
}
