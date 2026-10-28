import type { Trip } from "../../../../shared/types";
import { SearchBar } from "../../search/SearchBar";

/** The property is already selected: this inline control edits dates and guests. */
export function DetailTripControls({ trip, onChange }: { trip: Trip; onChange: (trip: Trip) => void }) {
  return <section className="figcraft-detail-section detail-trip-section" aria-label="Даты и гости">
    <h2>Даты и гости</h2>
    <div className="detail-trip-controls"><SearchBar trip={trip} onSearch={onChange} /></div>
  </section>;
}
