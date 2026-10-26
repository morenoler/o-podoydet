package ru.opodoydet.server.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Перенос учебной демо-базы старого бэкенда ({@code data/demo/preview.sqlite3}) в PostgreSQL:
 * данные на месте, а учебный аккаунт входит с тем же паролем — хеши паролей совместимы.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SqliteImporterIntegrationTest {

  static final Path DEMO = Path.of("../data/demo/preview.sqlite3");

  @Autowired SqliteImporter importer;
  @Autowired JdbcClient jdbc;
  @LocalServerPort int port;

  @Test
  void importsDemoAccountsAndKeepsPasswordsWorking() throws Exception {
    Map<String, Integer> copied = importer.importFile(DEMO.toAbsolutePath());

    assertThat(count("SELECT count(*) FROM account_users WHERE email LIKE '%@demo.test'")).isEqualTo(2);
    assertThat(count("SELECT count(*) FROM account_listings l JOIN account_users u ON u.id = l.host_id"
            + " WHERE u.email = 'host@demo.test'")).isEqualTo(4);
    assertThat(count("SELECT count(*) FROM account_bookings b JOIN account_users u ON u.id = b.user_id"
            + " WHERE u.email = 'user@demo.test'")).isEqualTo(6);
    assertThat(copied).containsKeys("account_users", "account_listings", "account_bookings", "account_questions");

    // Повторный импорт ничего не дублирует.
    importer.importFile(DEMO.toAbsolutePath());
    assertThat(count("SELECT count(*) FROM account_users WHERE email LIKE '%@demo.test'")).isEqualTo(2);

    HttpResponse<String> login =
        HttpClient.newBuilder()
            .proxy(HttpClient.Builder.NO_PROXY)
            .build()
            .send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/auth/login"))
                    .header("Content-Type", "application/json")
                    .POST(
                        HttpRequest.BodyPublishers.ofString(
                            "{\"email\":\"user@demo.test\",\"password\":\"UserDemo2026!\"}"))
                    .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(login.statusCode()).isEqualTo(200);
    assertThat(login.headers().allValues("Set-Cookie")).anyMatch(c -> c.startsWith("op_account_session="));
  }

  private long count(String sql) {
    return jdbc.sql(sql).query(Long.class).single();
  }
}
