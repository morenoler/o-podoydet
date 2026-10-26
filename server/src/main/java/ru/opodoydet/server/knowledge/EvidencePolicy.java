package ru.opodoydet.server.knowledge;

import java.net.URI;
import java.time.Instant;
import java.util.Set;

/**
 * Какие доказательства вообще можно учитывать.
 *
 * <p>{@link #legacyAdmissible} — точный перенос старого {@code Evidence.fact}: на нём держится
 * совместимость ответов старого API. {@link #admissible} — правило нового ядра; пока оно совпадает
 * со старым на всех данных, но уже допускает настоящие (не демонстрационные) ответы отельера и
 * выводы агентов без URL, потому что у них своя родословная.
 */
public final class EvidencePolicy {

  private static final Set<String> LEGACY_METHODS = Set.of("official", "geo");
  private static final Set<String> SELF_SOURCED_METHODS = Set.of("host", "agent");

  private EvidencePolicy() {}

  /** Старое правило verified-only; в demo-политике допускается всё. */
  public static boolean legacyAdmissible(Evidence e, Instant now, boolean demoPolicy) {
    if (demoPolicy) return true;
    return !e.isDemo() && LEGACY_METHODS.contains(e.getMethod()) && sourced(e, now);
  }

  /** Правило нового ядра для расчёта фактов. */
  public static boolean admissible(Evidence e, Instant now, boolean demoPolicy) {
    if (!e.isCurrent()) return false;
    if (demoPolicy) return true;
    if (e.isDemo() || "demo".equals(e.getMethod())) return false;
    if (SELF_SOURCED_METHODS.contains(e.getMethod()))
      return e.getObtainedAt() != null && !e.getObtainedAt().isAfter(now);
    return sourced(e, now);
  }

  /** Есть проверяемый http(s)-источник, цитата и дата получения не из будущего. */
  static boolean sourced(Evidence e, Instant now) {
    try {
      URI uri = URI.create(e.getSourceUrl() == null ? "" : e.getSourceUrl());
      return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
          && uri.getHost() != null
          && e.getQuote() != null
          && !e.getQuote().isBlank()
          && e.getObtainedAt() != null
          && !e.getObtainedAt().isAfter(now);
    } catch (RuntimeException invalid) {
      return false;
    }
  }
}
