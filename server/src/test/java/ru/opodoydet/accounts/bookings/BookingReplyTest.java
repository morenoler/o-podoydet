package ru.opodoydet.accounts.bookings;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class BookingReplyTest {
  private static ObjectNode seed() { return Json.obj("region","Пусан","hotels",List.of(),"facts",List.of()); }
  private static ObjectNode listing() {
    return Json.obj("title","Синтетический вариант","description","Тестовое объявление для проверки приватных ответов.",
        "city","Пусан","address","Тестовая улица","roomType","Студия","capacity",2,"pricePerNight",100,
        "amenities",List.of(),"status","published");
  }
  private static ObjectNode dates() {
    LocalDate from = LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(10);
    return Json.obj("checkIn",from.toString(),"checkOut",from.plusDays(3).toString(),"guests",2,"note","Уточните полную цену и отмену.");
  }

  @Test void privateReplyEditsPersistWithoutChangingPriceStatusOrSearchAndCoexistWithStatusUpdates() throws Exception {
    try (var fixture = TestDatabases.create(seed())) {
      var db = fixture.accounts();
      for (String id : List.of("host", "other-host", "guest", "other-guest"))
        db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            id,id+"@example.test","unused",id.contains("host")?"host":"user",id,Instant.now().toString());
      var listings = new ListingService(db);
      String listingId = Json.str(listings.create("host",listing()),"id");
      var bookings = new BookingService(db,listings);
      JsonNode original = bookings.request("guest",listingId,dates());
      String id = Json.str(original,"id");
      assertFalse(original.has("hostReply"));
      ObjectNode trip = dates(); trip.put("region","Пусан").put("adults",2).put("children",0).put("text","").put("admissionMode","explore");
      var provider = new OwnerListingSearchProvider(db);
      var before = provider.snapshot(trip).apply(List.of(),List.of(Json.obj("feature","pool","required",true)));
      ObjectNode input = Json.obj("message","  PRIVATE_REPLY_782: итоговая цена и условия обсуждаются отдельно.  ","status","confirmed","totalPrice",1);
      JsonNode reply = bookings.reply("host",id,input);
      assertEquals("pending",Json.str(reply,"status"));
      assertEquals(original.path("totalPrice"),reply.path("totalPrice"));
      assertEquals(original.path("pricePerNight"),reply.path("pricePerNight"));
      assertTrue(Json.str(reply,"hostReply").startsWith("PRIVATE_REPLY_782"));
      assertNotNull(Instant.parse(Json.str(reply,"repliedAt")));
      assertEquals(before,provider.snapshot(trip).apply(List.of(),List.of(Json.obj("feature","pool","required",true))));
      assertFalse(listings.published(listingId).toString().contains("PRIVATE_REPLY_782"));
      assertEquals(0,bookings.user("other-guest").size());
      assertEquals(0,bookings.host("other-host").size());
      assertEquals(reply,bookings.user("guest").getFirst());
      assertEquals(404,assertThrows(AccountProblem.class,() -> bookings.reply("other-host",id,input)).status);
      assertEquals(404,assertThrows(AccountProblem.class,() -> bookings.reply("host","missing",input)).status);
      for (JsonNode invalid : List.of(Json.obj(),Json.obj("message","  "),Json.obj("message",true),Json.obj("message","x".repeat(3001))))
        assertEquals(400,assertThrows(AccountProblem.class,() -> bookings.reply("host",id,invalid)).status);
      assertEquals(3000,Json.str(bookings.reply("host",id,Json.obj("message","x".repeat(3000))),"hostReply").length());
      JsonNode edited = bookings.reply("host",id,Json.obj("message","Исправленный приватный ответ."));
      assertEquals("Исправленный приватный ответ.",Json.str(edited,"hostReply"));
      assertFalse(Instant.parse(Json.str(edited,"repliedAt")).isBefore(Instant.parse(Json.str(reply,"repliedAt"))));
      try (var executor = Executors.newFixedThreadPool(2)) {
        Callable<JsonNode> answer = () -> bookings.reply("host",id,Json.obj("message","Ответ после уточнения."));
        Callable<JsonNode> confirm = () -> bookings.status("host",id,Json.obj("status","confirmed"));
        for (var outcome : executor.invokeAll(List.of(answer,confirm))) assertNotNull(outcome.get());
      }
      JsonNode concurrent = bookings.user("guest").getFirst();
      assertEquals("confirmed",Json.str(concurrent,"status"));
      assertEquals("Ответ после уточнения.",Json.str(concurrent,"hostReply"));
      assertEquals(original.path("totalPrice"),concurrent.path("totalPrice"));
      fixture.restart();
      var reloaded = new BookingService(fixture.accounts(),new ListingService(fixture.accounts()));
      assertEquals(concurrent,reloaded.user("guest").getFirst());
    }
  }

  private record Response(int status, JsonNode body) {}
  private static HttpClient browser() {
    return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
  }
  private static Response request(TestDatabases.Database api, HttpClient browser, String path, JsonNode body) throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+api.port()+"/api"+path));
    if (body == null) request.GET();
    else request.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
    var result = browser.send(request.build(),HttpResponse.BodyHandlers.ofString());
    return new Response(result.statusCode(),Json.read(result.body()));
  }
  private static void register(TestDatabases.Database api,HttpClient browser,String name,String role) throws Exception {
    assertEquals(201,request(api,browser,"/auth/register",Json.obj("name",name,"email",name+"@example.test","password","test password 123","role",role)).status());
  }
  @Test void httpReplyRequiresTheOwningHostAndOnlyTheRequestGuestCanReadIt() throws Exception {
    try (var api = TestDatabases.start(seed(),Map.of("ACCOUNT_MODE","true","LAB_MODE","true"))) {
      var host = browser(); var otherHost = browser(); var guest = browser(); var otherGuest = browser(); var anonymous = browser();
      register(api,host,"reply-host","host"); register(api,otherHost,"reply-other-host","host");
      register(api,guest,"reply-guest","user"); register(api,otherGuest,"reply-other-guest","user");
      var created = request(api,host,"/host/listings",listing());
      assertEquals(201,created.status());
      String listingId = Json.str(created.body(),"id");
      var asked = request(api,guest,"/listings/"+listingId+"/bookings",dates());
      assertEquals(201,asked.status());
      String endpoint = "/host/bookings/"+Json.str(asked.body(),"id")+"/reply";
      JsonNode message = Json.obj("message","PRIVATE_HTTP_REPLY_782: цену и отмену согласуем отдельно.");
      assertEquals(401,request(api,anonymous,endpoint,message).status());
      assertEquals(403,request(api,guest,endpoint,message).status());
      assertEquals(404,request(api,otherHost,endpoint,message).status());
      var saved = request(api,host,endpoint,message);
      assertEquals(200,saved.status());
      assertEquals("pending",Json.str(saved.body(),"status"));
      assertEquals(asked.body().path("totalPrice"),saved.body().path("totalPrice"));
      assertEquals(saved.body(),request(api,guest,"/account/bookings",null).body().get(0));
      assertEquals(saved.body(),request(api,host,"/host/bookings",null).body().get(0));
      assertTrue(request(api,otherGuest,"/account/bookings",null).body().isEmpty());
      assertTrue(request(api,otherHost,"/host/bookings",null).body().isEmpty());
      assertFalse(request(api,anonymous,"/listings/"+listingId,null).body().toString().contains("PRIVATE_HTTP_REPLY_782"));
      assertFalse(request(api,anonymous,"/listings/"+listingId+"/questions",null).body().toString().contains("PRIVATE_HTTP_REPLY_782"));
      assertEquals(400,request(api,host,endpoint,Json.obj("message"," ")).status());
    }
  }
}
