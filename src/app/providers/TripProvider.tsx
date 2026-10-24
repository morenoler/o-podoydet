import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Dataset, Preference, Trip } from "../../../shared/types";
import { api } from "../../shared/api/client";
type Catalog = Dataset & { mode: "rules" | "llm" };
const initialTrip: Trip = {
  region: "Пусан",
  checkIn: "",
  checkOut: "",
  adults: 2,
  children: 0,
  scenarios: [],
  preferences: [],
  text: "",
};
function readTrip() {
  try {
    const saved = JSON.parse(localStorage.getItem("o-trip-busan") || "null");
    return saved &&
      typeof saved === "object" &&
      Array.isArray(saved.preferences) &&
      Array.isArray(saved.scenarios)
      ? { ...initialTrip, ...saved }
      : initialTrip;
  } catch {
    return initialTrip;
  }
}
interface TripContextValue {
  trip: Trip;
  setTrip: (trip: Trip) => void;
  catalog: Catalog | null;
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
    setTripState(value);
    try {
      localStorage.setItem("o-trip-busan", JSON.stringify(value));
    } catch {
      /* storage can be unavailable in private mode */
    }
  };
  useEffect(() => {
    let active = true;
    api<Catalog>("/catalog")
      .then((c) => {
        if (active) setCatalog(c);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, []);
  return (
    <TripContext.Provider
      value={{
        trip,
        setTrip,
        catalog,
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
