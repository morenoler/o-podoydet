package ru.opodoydet.server.host;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;
import java.util.Optional;

interface HostQuestionRepository extends JpaRepository<HostQuestion, UUID> {

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select q from HostQuestion q where q.id = :id")
  Optional<HostQuestion> locked(UUID id);

  List<HostQuestion> findByStatusInOrderByPriorityDescCreatedAtAsc(
      Collection<HostQuestion.Status> statuses);

  List<HostQuestion> findByHotelIdAndStatusInOrderByPriorityDescCreatedAtAsc(
      String hotelId, Collection<HostQuestion.Status> statuses);

  default List<HostQuestion> findQueue(
      Collection<HostQuestion.Status> statuses, String hotelIdOrNull) {
    return hotelIdOrNull == null
        ? findByStatusInOrderByPriorityDescCreatedAtAsc(statuses)
        : findByHotelIdAndStatusInOrderByPriorityDescCreatedAtAsc(hotelIdOrNull, statuses);
  }
}
