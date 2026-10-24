import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useApp } from "./providers/TripProvider";
import { TripPage } from "../pages/TripPage";
import { WishesPage } from "../pages/WishesPage";
import { ResultsPage } from "../pages/ResultsPage";
import { HotelPage } from "../pages/HotelPage";
import { HostPage } from "../pages/HostPage";
function RequireTrip({ children }: { children: ReactNode }) {
  const { trip } = useApp();
  return trip.checkIn && trip.checkOut ? children : <Navigate to="/" replace />;
}
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<TripPage />} />
      <Route
        path="/wishes"
        element={
          <RequireTrip>
            <WishesPage />
          </RequireTrip>
        }
      />
      <Route
        path="/results"
        element={
          <RequireTrip>
            <ResultsPage />
          </RequireTrip>
        }
      />
      <Route
        path="/hotels/:id"
        element={
          <RequireTrip>
            <HotelPage />
          </RequireTrip>
        }
      />
      <Route path="/host" element={<HostPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
