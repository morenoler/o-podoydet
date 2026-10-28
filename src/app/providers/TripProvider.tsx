import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Dataset, Preference, Trip } from "../../../shared/types";
import { api } from "../../shared/api/client";
import { changeTripRegion, normalizeSearchTrip, restoreSearchTrip } from "../../features/search/searchPolicy";
import { isRegionName, type RegionCatalog } from "../../../shared/regions";
type Catalog = Dataset & { mode: "rules" | "llm" | "local_model" };
const initialTrip: Trip = {
  region: "Пусан",
  checkIn: "",
  checkOut: "",
  adults: 2,
  children: 0,
  scenarios: [],
  preferences: [],
  text: "",
  admissionMode: "explore",
};
function readTrip() {
  try {
    const saved = JSON.parse(localStorage.getItem("o-trip-busan") || "null");
    return restoreSearchTrip(saved, initialTrip);
  } catch {
    return initialTrip;
  }
}
interface TripContextValue {
  trip: Trip;
  setTrip: (trip: Trip) => void;
  catalog: Catalog | null;
  regions: string[];
  catalogError: string;
  revision: number;
  refresh: () => void;
  effectivePreferences: Preference[];
  rememberSearch: (trip: Trip, preferences: Preference[]) => void;
}
const TripContext = createContext<TripContextValue | null>(null);
export function useApp() {
  const context = useContext(TripContext);
  if (!context) throw new Error("TripProvider is required");
  return context;
}
export function TripProvider({ children }: { children: ReactNode }) {
  const [trip, setTripState] = useState<Trip>(readTrip),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [regionCatalog, setRegionCatalog] = useState<RegionCatalog | null>(null);
  const [resolved, setResolved] = useState<{
    key: string;
    preferences: Preference[];
  } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("o-resolved-busan") || "null");
    } catch {
      return null;
    }
  });
  const effectivePreferences =
    resolved?.key === JSON.stringify(trip)
      ? resolved.preferences
      : trip.preferences;
  const rememberSearch = (requestTrip: Trip, preferences: Preference[]) => {
    const value = { key: JSON.stringify(requestTrip), preferences };
    setResolved(value);
    try {
      sessionStorage.setItem("o-resolved-busan", JSON.stringify(value));
    } catch {
      /* optional cache */
    }
  };
  const setTrip = (value: Trip) => {
    const normalized = normalizeSearchTrip(value);
    setTripState(normalized);
    try {
      localStorage.setItem("o-trip-busan", JSON.stringify(normalized));
    } catch {
      /* storage can be unavailable in private mode */
    }
  };
  useEffect(() => {
    let active = true;
    api<RegionCatalog>("/regions")
      .then((available) => {
        if (!active) return;
        setRegionCatalog(available);
        setTripState((current) => available.regions.some((item) => item.region === current.region)
          ? current : { ...changeTripRegion(current, available.defaultRegion), hotelFilters: undefined });
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!regionCatalog || !regionCatalog.regions.some((item) => item.region === trip.region)) return;
    let active = true;
    const controller = new AbortController();
    setError("");
    setCatalog(null);
    api<Catalog>(`/catalog?region=${encodeURIComponent(trip.region)}`, undefined, controller.signal)
      .then((c) => {
        if (active) setCatalog(c);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [regionCatalog, trip.region]);
  return (
    <TripContext.Provider
      value={{
        trip,
        setTrip,
        catalog: catalog?.region === trip.region ? catalog : null,
        regions: regionCatalog?.regions.map((item) => item.region).filter(isRegionName) || [],
        catalogError: error,
        revision,
        refresh: () => setRevision((r) => r + 1),
        effectivePreferences,
        rememberSearch,
      }}
    >
      {children}
    </TripContext.Provider>
  );
}
