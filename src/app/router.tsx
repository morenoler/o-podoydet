import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useApp } from "./providers/TripProvider";
import { TripPage } from "../pages/TripPage";
import { WishesPage } from "../pages/WishesPage";
import { ResultsPage } from "../pages/ResultsPage";
import { HotelPage } from "../pages/HotelPage";
import { HostPage } from "../pages/HostPage";
import { lazy, Suspense } from "react";
const LabPage =
  import.meta.env.VITE_LAB_MODE === "true"
    ? lazy(() =>
        import("../pages/LabPage").then((module) => ({
          default: module.LabPage,
        })),
      )
    : null;
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
      {LabPage && (
        <Route
          path="/lab"
          element={
            <Suspense
              fallback={
                <p className="loading" role="status">
                  Открываем лабораторию…
                </p>
              }
            >
              <LabPage />
            </Suspense>
          }
        />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
