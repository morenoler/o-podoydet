import { useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { Trip } from "../../shared/types";
import { regionNames } from "../../shared/regions";
import { useApp } from "../app/providers/TripProvider";
import { EarthGlobe } from "../features/globe/EarthGlobe";
import { SearchBar } from "../features/search/SearchBar";
import { changeTripRegion } from "../features/search/searchPolicy";
import { catalogueRegionAtPoint, pointLabel, type GlobePoint } from "../features/search/landingSearch";
import "../features/search/search.css";
import "../features/search/globe-home.css";

export function HomePage() {
  const { trip, setTrip, regions, catalogError } = useApp();
  const [pickedPoint, setPickedPoint] = useState<GlobePoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [focusVersion, setFocusVersion] = useState(0);
  const navigate = useNavigate();
  const availableRegions = regions.length ? regions : [...regionNames];

  function chooseRegion(region: string) {
    if (!availableRegions.includes(region)) return;
    setPickedPoint(null);
    setSearchError("");
    setFocusVersion((value) => value + 1);
    setTrip(changeTripRegion(trip, region));
  }

  function choosePoint(point: GlobePoint) {
    const region = catalogueRegionAtPoint(point, availableRegions);
    if (region) chooseRegion(region);
    else setPickedPoint(point);
  }

  async function find(next: Trip) {
    if (pickedPoint || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      // Load the destination before the visual handover, so the map's frame
      // participates in the transition instead of a route-loading placeholder.
      await import("./ResultsPage");
      const enterResults = () => flushSync(() => { setTrip(next); navigate("/results"); });
      if (typeof document.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(enterResults);
      } else enterResults();
    } catch {
      setSearchError("Не удалось открыть поиск. Попробуйте ещё раз.");
      setSearching(false);
    }
  }

  return <div className="globe-home">
    <section className="globe-home-search" aria-labelledby="home-title">
      <h1 id="home-title">Любая точка мира —<br />начало путешествия</h1>
      <SearchBar trip={trip} regions={availableRegions} variant="landing" busy={searching}
        destinationLabel={pickedPoint ? pointLabel(pickedPoint) : undefined} searchDisabled={!!pickedPoint}
        onChange={(next, field) => {
          if (field === "region") { setPickedPoint(null); setSearchError(""); setFocusVersion((value) => value + 1); }
          setTrip(next);
        }} onSearch={find} />
      {pickedPoint && <p className="globe-home-note" id="landing-coverage-note" role="status">
        Для этой точки пока нет отелей в каталоге. Выберите <button type="button" onClick={() => chooseRegion("Пусан")}>Пусан</button> или <button type="button" onClick={() => chooseRegion("Сочи")}>Сочи</button>.
      </p>}
      {(searchError || catalogError) && <div className="globe-home-note" role="alert">
        <p>{searchError || "Каталог временно недоступен. Параметры поездки сохранены."}</p>
        {catalogError && <button type="button" onClick={() => window.location.reload()}>Повторить загрузку</button>}
      </div>}
    </section>
    <div className="home-globe-stage">
      <EarthGlobe selectedRegion={trip.region} selectedPoint={pickedPoint} focusVersion={focusVersion} onSelectRegion={chooseRegion} onPickPoint={choosePoint} />
    </div>
  </div>;
}
