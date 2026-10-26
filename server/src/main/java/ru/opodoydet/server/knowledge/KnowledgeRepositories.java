package ru.opodoydet.server.knowledge;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface CharacteristicRepository extends JpaRepository<Characteristic, String> {}

interface EvidenceRepository extends JpaRepository<Evidence, String> {

  @Query("select e from Evidence e where e.active = true order by e.ord")
  List<Evidence> findActive();

  @Query("select e from Evidence e where e.active = true and e.hotelId = ?1 order by e.ord")
  List<Evidence> findActiveByHotel(String hotelId);
}

interface FactRepository extends JpaRepository<Fact, Long> {

  List<Fact> findByHotelIdOrderByRoomIdAscCharacteristicAsc(String hotelId);
}

interface ConflictRepository extends JpaRepository<Conflict, Long> {

  @Query("select c from Conflict c where c.resolvedAt is null")
  List<Conflict> findOpen();

  @Query("select c from Conflict c where c.hotelId = ?1 order by c.detectedAt desc")
  List<Conflict> findByHotel(String hotelId);
}
