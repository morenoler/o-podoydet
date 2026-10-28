package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class LocalJsonModelTest {
  private static ObjectNode trip() {
    return Json.obj("region","Пусан","checkIn","2027-06-10","checkOut","2027-06-17","adults",2,"children",0,
        "text","","preferences",List.of(Json.obj("feature","dishwasher","required",true)),"scenarios",List.of());
  }
  private static JsonNode envelope(JsonNode answer) {
    return Json.obj("done",true,"done_reason","stop","message",Json.obj("role","assistant","content",Json.write(answer)));
  }
  private static HttpServer fake(AtomicReference<JsonNode> output, AtomicReference<JsonNode> request) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/api/chat",exchange -> {
      request.set(Json.read(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));
      assertNull(exchange.getRequestHeaders().getFirst("Authorization"));
      byte[] bytes = Json.write(output.get()).getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start(); return server;
  }
  private static String base(HttpServer server) { return "http://127.0.0.1:"+server.getAddress().getPort()+"/v1"; }
  private static JsonNode pref(String feature,boolean required) { return Json.obj("feature",feature,"required",required); }
  private static JsonNode edit(String feature,String action) { return Json.obj("feature",feature,"action",action); }
  private static JsonNode edits(JsonNode... changes) { return envelope(Json.obj("updates",List.of(changes),"unhandled",List.of())); }

  @Test void localSchemaProtocolWorksWithoutAKeyAndUsesTruthfulMode() throws Exception {
    var output = new AtomicReference<>(envelope(Json.obj("preferences",List.of(pref("washing_machine",true)),"excluded",List.of(),"warnings",List.of())));
    var request = new AtomicReference<JsonNode>(); var server = fake(output,request);
    try {
      Agents agents = new Agents(new Agents.Config("","fixture",base(server)));
      assertTrue(agents.enabled()); assertEquals("local_model",agents.mode());
      JsonNode result = agents.interpret(trip().put("text","Обязательно стиральная машина"));
      assertEquals("local_model",result.path("mode").asText());
      assertEquals(2,result.path("preferences").size());
      assertEquals("object",request.get().path("format").path("type").asText());
      assertEquals(500,request.get().path("options").path("num_predict").asInt());
      assertFalse(request.get().path("stream").asBoolean());
      output.set(edits(edit("washing_machine","required")));
      JsonNode next = new SearchConversation(agents).refine(trip(),"Обязательно стиральная машина",Json.array(List.of()));
      assertEquals("local_model",next.path("mode").asText());
      assertEquals(trip().path("checkIn"),next.path("trip").path("checkIn"));
      output.set(envelope(Json.obj("preferences",List.of(pref("low_noise",false)),"excluded",List.of(),"warnings",List.of())));
      assertEquals("local_model",agents.interpret(trip().put("text","Хочу тишины")).path("mode").asText(),"An optional courtyard proxy is not an explicit wish");
    } finally { server.stop(0); }
  }

  @Test void validJsonCannotOmitWeakenOrRemoveExplicitMandatoryWishesOrUnrelatedConditions() throws Exception {
    var output = new AtomicReference<JsonNode>(); var request = new AtomicReference<JsonNode>(); var server = fake(output,request);
    try {
      Agents agents = new Agents(new Agents.Config("","fixture",base(server)));
      for (JsonNode candidate : List.of(edits(),edits(edit("washing_machine","optional")),edits(edit("washing_machine","remove")),
          edits(edit("washing_machine","required"),edit("dishwasher","optional")))) {
        output.set(candidate);
        JsonNode result = new SearchConversation(agents).refine(trip(),"Обязательно стиральная машина",Json.array(List.of()));
        assertEquals("rules",result.path("mode").asText());
        assertFalse(result.path("warnings").isEmpty());
        assertEquals(2,result.path("trip").path("preferences").size());
        result.path("trip").path("preferences").forEach(preference -> assertTrue(preference.path("required").asBoolean()));
      }
      for (JsonNode candidate : List.of(Json.obj("preferences",List.of(pref("washing_machine",false)),"excluded",List.of(),"warnings",List.of()),
          Json.obj("preferences",List.of(),"excluded",List.of("washing_machine"),"warnings",List.of()))) {
        output.set(envelope(candidate));
        JsonNode result = agents.interpret(trip().put("text","Обязательно стиральная машина"));
        assertEquals("rules",result.path("mode").asText());
        result.path("preferences").forEach(preference -> assertTrue(preference.path("required").asBoolean()));
      }
      output.set(edits(edit("dishwasher","required")));
      assertEquals("rules",new SearchConversation(agents).refine(trip(),"Посудомойка не обязательна",Json.array(List.of())).path("mode").asText());
      assertEquals("rules",new SearchConversation(agents).refine(trip(),"Убери посудомойку",Json.array(List.of())).path("mode").asText());
      output.set(edits(edit("pool","required")));
      JsonNode optional = new SearchConversation(agents).refine(trip(),"Хочу бассейн",Json.array(List.of()));
      assertEquals("rules",optional.path("mode").asText());
      assertFalse(optional.path("trip").path("preferences").get(1).path("required").asBoolean());
      output.set(edits(edit("washing_machine","required"),edit("pool","optional")));
      assertEquals("rules",new SearchConversation(agents).refine(trip(),"Обязательно стиральная машина",Json.array(List.of())).path("mode").asText());
    } finally { server.stop(0); }
  }

  @Test void localTransportRejectsRemoteCredentialsCloudModelsTruncationAndOversizedBodies() throws Exception {
    for (String url : List.of("https://example.test/v1","http://user:password@localhost:11434/v1","http://127.0.0.1:11434/v1?key=secret"))
      assertThrows(IllegalArgumentException.class,() -> new LocalJsonModel(url,"fixture"));
    assertThrows(IllegalArgumentException.class,() -> new LocalJsonModel("http://localhost:11434/v1","fixture-cloud"));
    assertFalse(new Agents(new Agents.Config("key","fixture","http://user:password@localhost:11434/v1")).enabled());
    var output = new AtomicReference<JsonNode>(); var request = new AtomicReference<JsonNode>(); var server = fake(output,request);
    try {
      var local = new LocalJsonModel(base(server),"fixture");
      output.set(Json.obj("done",true,"done_reason","length","message",Json.obj("content","{}")));
      assertThrows(IOException.class,() -> local.complete("test",Json.obj(),Json.obj()));
      output.set(Json.obj("padding","x".repeat(100_001)));
      assertThrows(IOException.class,() -> local.complete("test",Json.obj(),Json.obj()));
    } finally { server.stop(0); }
  }

  @Test void deadlineIncludesAStalledResponseBody() throws Exception {
    var executor = Executors.newCachedThreadPool();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.setExecutor(executor);
    server.createContext("/api/chat",exchange -> {
      exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(200,0);
      exchange.getResponseBody().write('{'); exchange.getResponseBody().flush();
      try { Thread.sleep(3000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
      exchange.close();
    });
    server.start();
    try {
      var local = new LocalJsonModel(base(server),"fixture",Duration.ofMillis(250));
      assertTimeoutPreemptively(Duration.ofSeconds(2),() -> assertThrows(IOException.class,() -> local.complete("test",Json.obj(),Json.obj())));
    } finally { server.stop(0); executor.shutdownNow(); }
  }
}
