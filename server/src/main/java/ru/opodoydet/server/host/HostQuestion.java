package ru.opodoydet.server.host;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.UUID;
import ru.opodoydet.server.knowledge.Subject;

/** Вопрос, который агент задал отельеру, и что из этого вышло. */
@Entity
@Table(name = "host_question")
public class HostQuestion {

  public enum Status {
    /** Ждёт ответа. */
    open,
    /** Из ответа извлечено значение спрошенной характеристики. */
    answered,
    /** Ответ получен, но нужного значения в нём нет — вопрос можно задать снова. */
    unresolved,
    /** Больше не актуален: факт подтвердился из другого источника или другого ответа. */
    cancelled
  }

  @Id private UUID id;

  @Column(name = "hotel_id", nullable = false)
  private String hotelId;

  @Column(name = "room_id")
  private String roomId;

  @Column(nullable = false)
  private String characteristic;

  @Column(nullable = false)
  private String text;

  @Column(nullable = false)
  private String reason;

  @Column(name = "trigger_status", nullable = false)
  private String triggerStatus;

  @Column(nullable = false, precision = 4, scale = 3)
  private BigDecimal priority;

  @Column(nullable = false)
  @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
  private Status status;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "answered_at")
  private Instant answeredAt;

  @Column(name = "answer_text")
  private String answerText;

  @Column(name = "answer_channel")
  private String answerChannel;

  private String extractor;

  protected HostQuestion() {}

  HostQuestion(
      Subject subject,
      String text,
      String reason,
      String triggerStatus,
      double priority,
      Instant createdAt) {
    this.id = UUID.randomUUID();
    this.hotelId = subject.hotelId();
    this.roomId = subject.roomId();
    this.characteristic = subject.characteristic();
    this.text = text;
    this.reason = reason;
    this.triggerStatus = triggerStatus;
    this.priority = BigDecimal.valueOf(priority).setScale(3, RoundingMode.HALF_UP);
    this.status = Status.open;
    this.createdAt = createdAt;
  }

  void answer(Status result, String text, String channel, String extractor, Instant at) {
    this.status = result;
    this.answerText = text;
    this.answerChannel = channel;
    this.extractor = extractor;
    this.answeredAt = at;
  }

  void cancel(String why, Instant at) {
    this.status = Status.cancelled;
    this.answerText = why;
    this.answeredAt = at;
  }

  boolean acceptsAnswer() {
    return status == Status.open || status == Status.unresolved;
  }

  public Subject subject() {
    return new Subject(hotelId, roomId, characteristic);
  }

  public UUID getId() {
    return id;
  }

  public String getHotelId() {
    return hotelId;
  }

  public String getRoomId() {
    return roomId;
  }

  public String getCharacteristic() {
    return characteristic;
  }

  public String getText() {
    return text;
  }

  public String getReason() {
    return reason;
  }

  public String getTriggerStatus() {
    return triggerStatus;
  }

  public BigDecimal getPriority() {
    return priority;
  }

  public Status getStatus() {
    return status;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getAnsweredAt() {
    return answeredAt;
  }

  public String getAnswerText() {
    return answerText;
  }

  public String getAnswerChannel() {
    return answerChannel;
  }

  public String getExtractor() {
    return extractor;
  }
}
