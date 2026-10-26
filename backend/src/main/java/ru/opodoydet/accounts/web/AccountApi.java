package ru.opodoydet.accounts.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.SQLException;
import java.util.List;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.accounts.questions.QuestionService;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.RequestBodies;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** MVC endpoints preserve account authorization and delegate work to feature services. */
@RestController
@ConditionalOnProperty(name = "ACCOUNT_MODE", havingValue = "true", matchIfMissing = true)
public final class AccountApi {
  private static final String COOKIE = "op_account_session";
  private final AuthService auth;
  private final ListingService listings;
  private final BookingService bookings;
  private final QuestionService questions;
  private final PhotoService photos;
  private final boolean secureCookie;

  public AccountApi(
      AuthService auth,
      ListingService listings,
      BookingService bookings,
      QuestionService questions,
      PhotoService photos,
      AppSettings settings) {
    this.auth = auth;
    this.listings = listings;
    this.bookings = bookings;
    this.questions = questions;
    this.photos = photos;
    secureCookie = settings.enabled("SESSION_COOKIE_SECURE", false);
  }

  /** Preserve the account API's content-type check before authorization and parsing. */
  @ModelAttribute
  public void validateContentType(HttpServletRequest request) {
    if (!request.getMethod().equals("POST")
        || request.getRequestURI().equals("/api/host/photos")
        || request.getRequestURI().startsWith("/uploads/")) return;
    String contentType = request.getContentType();
    if (contentType == null
        || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
      throw new AccountProblem(415, "Используйте формат application/json.");
  }

  @GetMapping("/api/auth/me")
  public JsonNode current(HttpServletRequest request) throws SQLException {
    return Json.obj("user", auth.current(token(request)));
  }

  @PostMapping("/api/auth/register")
  public ResponseEntity<JsonNode> register(HttpServletRequest request)
      throws SQLException, IOException {
    return signedIn(201, auth.register(body(request), token(request), request.getRemoteAddr()));
  }

  @PostMapping("/api/auth/login")
  public ResponseEntity<JsonNode> login(HttpServletRequest request)
      throws SQLException, IOException {
    return signedIn(200, auth.login(body(request), token(request), request.getRemoteAddr()));
  }

  @PostMapping("/api/auth/logout")
  public ResponseEntity<JsonNode> logout(HttpServletRequest request)
      throws SQLException, IOException {
    body(request);
    auth.logout(token(request));
    return ResponseEntity.ok()
        .header(HttpHeaders.SET_COOKIE, cookie("", 0))
        .body(Json.obj("ok", true));
  }

  @PostMapping("/api/account/profile")
  public JsonNode profile(HttpServletRequest request) throws SQLException, IOException {
    return Json.obj("user", auth.profile(auth.require(token(request), null), body(request)));
  }

  @GetMapping("/api/account/bookings")
  public List<ObjectNode> userBookings(HttpServletRequest request) throws SQLException {
    return bookings.user(user(request, "user"));
  }

  @GetMapping("/api/account/questions")
  public List<ObjectNode> userQuestions(HttpServletRequest request) throws SQLException {
    return questions.user(user(request, "user"));
  }

  @PostMapping("/api/account/bookings/{id}/cancel")
  public JsonNode cancelBooking(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    String user = user(request, "user");
    body(request);
    return bookings.cancel(user, id);
  }

  @GetMapping("/api/host/listings")
  public List<ObjectNode> hostListings(HttpServletRequest request) throws SQLException {
    return listings.owned(user(request, "host"));
  }

  @PostMapping("/api/host/listings")
  public ResponseEntity<JsonNode> createListing(HttpServletRequest request)
      throws SQLException, IOException {
    return ResponseEntity.status(201).body(listings.create(user(request, "host"), body(request)));
  }

  @GetMapping("/api/host/listings/{id}")
  public JsonNode ownedListing(@PathVariable String id, HttpServletRequest request)
      throws SQLException {
    return listings.owned(id, user(request, "host"));
  }

  @PostMapping("/api/host/listings/{id}")
  public JsonNode updateListing(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    return listings.update(user(request, "host"), id, body(request));
  }

  @GetMapping("/api/host/bookings")
  public List<ObjectNode> hostBookings(HttpServletRequest request) throws SQLException {
    return bookings.host(user(request, "host"));
  }

  @GetMapping("/api/host/questions")
  public List<ObjectNode> hostQuestions(HttpServletRequest request) throws SQLException {
    return questions.host(user(request, "host"));
  }

  @PostMapping("/api/host/questions/{id}/answer")
  public JsonNode answerQuestion(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    return questions.answer(user(request, "host"), id, body(request));
  }

  @PostMapping("/api/host/bookings/{id}/status")
  public JsonNode bookingStatus(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    return bookings.status(user(request, "host"), id, body(request));
  }

  @GetMapping("/api/listings")
  public List<ObjectNode> publishedListings() throws SQLException {
    return listings.published();
  }

  @GetMapping("/api/listings/{id}")
  public JsonNode publishedListing(@PathVariable String id) throws SQLException {
    return listings.published(id);
  }

  @GetMapping("/api/listings/{id}/questions")
  public List<ObjectNode> publishedQuestions(@PathVariable String id) throws SQLException {
    return questions.published(id);
  }

  @PostMapping("/api/listings/{id}/questions")
  public ResponseEntity<JsonNode> askQuestion(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    return ResponseEntity.status(201).body(questions.ask(user(request, "user"), id, body(request)));
  }

  @PostMapping("/api/listings/{id}/bookings")
  public ResponseEntity<JsonNode> requestBooking(
      @PathVariable String id, HttpServletRequest request) throws SQLException, IOException {
    return ResponseEntity.status(201)
        .body(bookings.request(user(request, "user"), id, body(request)));
  }

  @PostMapping("/api/host/photos")
  public ResponseEntity<JsonNode> upload(HttpServletRequest request)
      throws SQLException, IOException {
    String owner = user(request, "host");
    return ResponseEntity.status(201)
        .body(
            photos.upload(
                request.getInputStream(),
                request.getContentType(),
                request.getHeader(HttpHeaders.CONTENT_LENGTH),
                owner));
  }

  @RequestMapping("/uploads/**")
  public ResponseEntity<?> photo(HttpServletRequest request) throws SQLException, IOException {
    if (!Set.of("GET", "HEAD").contains(request.getMethod()))
      throw new AccountProblem(404, "Фотография не найдена.");
    // getRequestURI retains percent-encoding; the service accepts only canonical upload URLs.
    PhotoService.Asset asset =
        photos.resolve(request.getRequestURI(), auth.current(token(request)));
    var response =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(asset.mime()))
            .contentLength(asset.size())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "default-src 'none'; sandbox")
            .header("Cross-Origin-Resource-Policy", "same-origin")
            .header(
                HttpHeaders.CONTENT_DISPOSITION,
                "inline; filename=\"" + asset.file().getFileName() + "\"");
    return request.getMethod().equals("HEAD")
        ? response.build()
        : response.body(new FileSystemResource(asset.file()));
  }

  @RequestMapping({"/api/auth/**", "/api/account/**", "/api/host/**", "/api/listings/**"})
  public void missingAccountRoute(HttpServletRequest request) throws SQLException {
    String path = request.getRequestURI();
    if (path.startsWith("/api/account/")) user(request, "user");
    if (path.startsWith("/api/host/")) user(request, "host");
    throw new AccountProblem(404, "Метод не найден.");
  }

  private String user(HttpServletRequest request, String role) throws SQLException {
    return Json.str(auth.require(token(request), role), "id");
  }

  private static JsonNode body(HttpServletRequest request) throws IOException {
    return RequestBodies.json(request, 413);
  }

  private ResponseEntity<JsonNode> signedIn(int status, AuthService.Session session) {
    return ResponseEntity.status(status)
        .header(HttpHeaders.SET_COOKIE, cookie(session.token(), 2592000))
        .body(Json.obj("user", session.user()));
  }

  private String cookie(String token, int maxAge) {
    return COOKIE
        + "="
        + token
        + "; Path=/; HttpOnly; SameSite=Lax; Max-Age="
        + maxAge
        + (secureCookie ? "; Secure" : "");
  }

  private static String token(HttpServletRequest request) {
    var headers = request.getHeaders(HttpHeaders.COOKIE);
    while (headers.hasMoreElements())
      for (String cookie : headers.nextElement().split(";")) {
        String[] pair = cookie.trim().split("=", 2);
        if (pair.length != 2 || !pair[0].equals(COOKIE)) continue;
        String value = pair[1];
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2)
          value = value.substring(1, value.length() - 1);
        if (value.matches("[A-Za-z0-9_-]{43}")) return value;
      }
    return null;
  }
}
