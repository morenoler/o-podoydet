package ru.opodoydet.server.catalog;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HotelRepository extends JpaRepository<Hotel, String> {

  @EntityGraph(attributePaths = "rooms")
  List<Hotel> findByRegionAndActiveTrueOrderByOrd(String region);

  @EntityGraph(attributePaths = "rooms")
  Optional<Hotel> findByIdAndActiveTrue(String id);

  long countByRegionAndActiveTrue(String region);
}
