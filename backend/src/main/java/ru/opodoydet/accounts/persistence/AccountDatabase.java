package ru.opodoydet.accounts.persistence;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import ru.opodoydet.shared.Json;

/** Separate connection and unit of work for account features. */
public final class AccountDatabase implements AutoCloseable {
  private final Connection connection;

  public AccountDatabase(String path) throws SQLException, IOException {
    connection = DriverManager.getConnection("jdbc:sqlite:" + path);
    try (var input = AccountDatabase.class.getResourceAsStream("/accounts-schema.sql")) {
      if (input == null) throw new IOException("accounts-schema.sql not found");
      for (String sql : new String(input.readAllBytes(), StandardCharsets.UTF_8).split(";"))
        if (!sql.isBlank())
          try (var statement = connection.createStatement()) {
            statement.execute(sql);
          }
      AccountMigrations.apply(this);
    } catch (SQLException | IOException | RuntimeException e) {
      connection.close();
      throw e;
    }
  }

  public synchronized int execute(String sql, Object... values) throws SQLException {
    try (var statement = prepare(sql, values)) {
      // SQLite DDL may expose a result set while validating a new CHECK constraint.
      statement.execute();
      return Math.max(0, statement.getUpdateCount());
    }
  }

  public synchronized List<ObjectNode> rows(String sql, Object... values) throws SQLException {
    try (var statement = prepare(sql, values);
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
    }
  }

  public synchronized ObjectNode one(String sql, Object... values) throws SQLException {
    var rows = rows(sql, values);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private PreparedStatement prepare(String sql, Object[] values) throws SQLException {
    PreparedStatement statement = connection.prepareStatement(sql);
    for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
    return statement;
  }

  @FunctionalInterface
  public interface Work<T> {
    T run() throws SQLException;
  }

  public synchronized <T> T transaction(Work<T> work) throws SQLException {
    connection.setAutoCommit(false);
    try {
      T value = work.run();
      connection.commit();
      return value;
    } catch (SQLException | RuntimeException e) {
      connection.rollback();
      throw e;
    } finally {
      connection.setAutoCommit(true);
    }
  }

  @Override
  public synchronized void close() throws SQLException {
    connection.close();
  }
}
