package ru.opodoydet.server.host;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface HostQuestionRepository extends JpaRepository<HostQuestion, UUID> {

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
