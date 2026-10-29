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

  @Query("select e from Evidence e where e.active = true and e.hotelId in ?1 order by e.ord")
  List<Evidence> findActiveByHotels(java.util.Collection<String> hotelIds);
}

interface FactRepository extends JpaRepository<Fact, Long> {

  List<Fact> findByHotelIdOrderByRoomIdAscCharacteristicAsc(String hotelId);

  List<Fact> findByHotelIdIn(java.util.Collection<String> hotelIds);

  @Query("select f from Fact f where (?1 is null or f.hotelId = ?1) and f.status <> ?2")
  List<Fact> findGaps(String hotelId, Fact.Status excludedStatus);
}

interface ConflictRepository extends JpaRepository<Conflict, Long> {

  @Query("select c from Conflict c where c.resolvedAt is null")
  List<Conflict> findOpen();

  @Query("select c from Conflict c where c.hotelId = ?1 order by c.detectedAt desc")
  List<Conflict> findByHotel(String hotelId);
}
