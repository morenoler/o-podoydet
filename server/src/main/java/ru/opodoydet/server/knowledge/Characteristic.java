package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Характеристика как данные, а не как код: что измеряем, на каком уровне (отель или категория
 * номера), каким инструментом и сколько живёт значение. Новая характеристика — новая строка.
 */
@Entity
@Table(name = "characteristic")
public class Characteristic {

  @Id private String code;

  @Column(nullable = false)
  private String label;

  /** hotel | room */
  @Column(nullable = false)
  private String scope;

  /** route | host | area | ... — каким инструментом добывается значение. */
  @Column(nullable = false)
  private String tool;

  /** boolean | meters | assessment */
  @Column(name = "value_type", nullable = false)
  private String valueType;

  private String question;
  private String positive;
  private String negative;
  private Integer threshold;

  @Column(name = "ttl_days", nullable = false)
  private int ttlDays;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(nullable = false)
  private JsonNode spec;

  protected Characteristic() {}

  /** Характеристика вне БД — для тестов разбора и описаний в коде. */
  public static Characteristic of(String code, String scope, String tool, String valueType) {
    Characteristic c = new Characteristic();
    c.code = code;
    c.label = code;
    c.scope = scope;
    c.tool = tool;
    c.valueType = valueType;
    c.ttlDays = 30;
    c.spec = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
    return c;
  }

  public String getCode() {
    return code;
  }

  public String getLabel() {
    return label;
  }

  public String getScope() {
    return scope;
  }

  public String getTool() {
    return tool;
  }

  public String getValueType() {
    return valueType;
  }

  public String getQuestion() {
    return question;
  }

  public String getPositive() {
    return positive;
  }

  public String getNegative() {
    return negative;
  }

  public Integer getThreshold() {
    return threshold;
  }

  public int getTtlDays() {
    return ttlDays;
  }

  public JsonNode getSpec() {
    return spec;
  }
}
