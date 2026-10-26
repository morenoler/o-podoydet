package ru.opodoydet.accounts.persistence;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import ru.opodoydet.shared.Json;

/**
 * Единица работы для кабинетов поверх PostgreSQL.
 *
 * <p>API прежний (execute / rows / one / transaction), поэтому репозитории кабинетов перенесены
 * почти без изменений. Соединение берётся из пула Spring: внутри {@link #transaction} все вызовы
 * идут в одной транзакции, вне её — каждый вызов сам по себе.
 */
public final class AccountDatabase {
  /** SQLState нарушения уникальности в PostgreSQL (в SQLite был код 19). */
  public static final String UNIQUE_VIOLATION = "23505";

  private final DataSource dataSource;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;

  public AccountDatabase(DataSource dataSource, TransactionTemplate tx) {
    this.dataSource = dataSource;
    this.tx = new TransactionTemplate(tx.getTransactionManager());
    this.tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    this.readTx = new TransactionTemplate(tx.getTransactionManager());
    this.readTx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    this.readTx.setReadOnly(true);
  }

  public int execute(String sql, Object... values) throws SQLException {
    Connection connection = DataSourceUtils.getConnection(dataSource);
    try (var statement = prepare(connection, sql, values)) {
      statement.execute();
      return Math.max(0, statement.getUpdateCount());
    } finally {
      DataSourceUtils.releaseConnection(connection, dataSource);
    }
  }

  public List<ObjectNode> rows(String sql, Object... values) throws SQLException {
    Connection connection = DataSourceUtils.getConnection(dataSource);
    try (var statement = prepare(connection, sql, values);
        var rs = statement.executeQuery()) {
      List<ObjectNode> rows = new ArrayList<>();
      var metadata = rs.getMetaData();
      while (rs.next()) {
        ObjectNode row = Json.obj();
        for (int i = 1; i <= metadata.getColumnCount(); i++)
          row.set(metadata.getColumnLabel(i), Json.MAPPER.valueToTree(rs.getObject(i)));
        rows.add(row);
      }
      return rows;
    } finally {
      DataSourceUtils.releaseConnection(connection, dataSource);
    }
  }

  public ObjectNode one(String sql, Object... values) throws SQLException {
    var rows = rows(sql, values);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private static final java.util.regex.Pattern ALIAS =
      java.util.regex.Pattern.compile("\\b(?i:AS)\\s+([a-z_][a-z0-9_]*[A-Z][A-Za-z0-9_]*)\\b");

  /**
   * PostgreSQL приводит псевдонимы без кавычек к нижнему регистру ({@code AS hostId} → hostid),
   * а JSON-ответы используют camelCase. Берём псевдонимы со смешанным регистром в кавычки.
   */
  static String quoteAliases(String sql) {
    return ALIAS.matcher(sql).replaceAll("AS \"$1\"");
  }

  private static PreparedStatement prepare(Connection connection, String sql, Object[] values)
      throws SQLException {
    PreparedStatement statement = connection.prepareStatement(quoteAliases(sql));
    for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
    return statement;
  }

  @FunctionalInterface
  public interface Work<T> {
    T run() throws SQLException;
  }

  private static final class Wrapped extends RuntimeException {
    Wrapped(SQLException cause) {
      super(cause);
    }
  }

  /** Several projection queries must observe one committed snapshot. */
  public <T> T readTransaction(Work<T> work) throws SQLException {
    return inTransaction(readTx, work);
  }

  /** Serialize only the offer being changed, including revisions, bookings and scope changes. */
  public void lockListing(String listing) throws SQLException {
    requireTransaction();
    one("SELECT id FROM account_listings WHERE id=? FOR UPDATE", listing);
  }

  /** Repeated request keys must serialize even if their payload names different listings. */
  public void lockRequest(String owner, String key) throws SQLException {
    requireTransaction();
    execute("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", owner + ":" + key);
  }

  private static void requireTransaction() {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("A write lock requires an active account transaction");
  }

  public <T> T transaction(Work<T> work) throws SQLException {
    return inTransaction(tx, work);
  }

  private <T> T inTransaction(TransactionTemplate template, Work<T> work) throws SQLException {
    try {
      return template.execute(
          status -> {
            try {
              return work.run();
            } catch (SQLException e) {
              throw new Wrapped(e);
            }
          });
    } catch (Wrapped wrapped) {
      throw (SQLException) wrapped.getCause();
    }
  }
}
