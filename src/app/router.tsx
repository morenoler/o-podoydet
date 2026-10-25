import { lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "../features/auth/RequireAuth";
import { useApp } from "./providers/TripProvider";
import { ErrorMessage } from "../shared/ui/Feedback";

const TripPage = lazy(() =>
  import("../pages/TripPage").then((m) => ({ default: m.TripPage })),
);
const WishesPage = lazy(() =>
  import("../pages/WishesPage").then((m) => ({ default: m.WishesPage })),
);
const ResultsPage = lazy(() =>
  import("../pages/ResultsPage").then((m) => ({ default: m.ResultsPage })),
);
const HotelPage = lazy(() =>
  import("../pages/HotelPage").then((m) => ({ default: m.HotelPage })),
);
const LabPage =
  import.meta.env.VITE_LAB_MODE === "true"
    ? lazy(() =>
        import("../pages/LabPage").then((m) => ({ default: m.LabPage })),
      )
    : null;
const AuthPage = lazy(() =>
  import("../pages/AuthPage").then((m) => ({ default: m.AuthPage })),
);
const AccountPage = lazy(() =>
  import("../pages/AccountPage").then((m) => ({ default: m.AccountPage })),
);
const HostAccountPage = lazy(() =>
  import("../pages/HostAccountPage").then((m) => ({
    default: m.HostAccountPage,
  })),
);
const ListingsPage = lazy(() =>
  import("../pages/ListingsPage").then((m) => ({ default: m.ListingsPage })),
);
const ListingPage = lazy(() =>
  import("../pages/ListingPage").then((m) => ({ default: m.ListingPage })),
);

const FavoritesPage = lazy(() =>
  import("../pages/FavoritesPage").then((m) => ({
    default: m.FavoritesPage,
  })),
);
const AboutPage = lazy(() =>
  import("../pages/AboutPage").then((m) => ({ default: m.AboutPage })),
);

function SearchScreen({
  children,
  tripRequired = true,
}: {
  children: ReactNode;
  tripRequired?: boolean;
}) {
  const { trip, catalogError } = useApp();
  if (catalogError)
    return (
      <div className="page">
        <h1>Каталог пока недоступен</h1>
        <ErrorMessage text={catalogError} />
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Повторить загрузку
        </button>
      </div>
    );
  if (tripRequired && (!trip.checkIn || !trip.checkOut))
    return <Navigate to="/" replace />;
  return children;
}

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <p className="loading" role="status">
          Загружаем страницу…
        </p>
      }
    >
      <Routes>
        <Route
          path="/"
          element={
            <SearchScreen tripRequired={false}>
              <ResultsPage />
            </SearchScreen>
          }
        />
        <Route
          path="/trip"
          element={
            <SearchScreen tripRequired={false}>
              <TripPage />
            </SearchScreen>
          }
        />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route
          path="/wishes"
          element={
            <SearchScreen>
              <WishesPage />
            </SearchScreen>
          }
        />
        <Route
          path="/results"
          element={
            <SearchScreen tripRequired={false}>
              <ResultsPage />
            </SearchScreen>
          }
        />
        <Route
          path="/hotels/:id"
          element={
            <SearchScreen tripRequired={false}>
              <HotelPage />
            </SearchScreen>
          }
        />
        {LabPage && (
          <Route
            path="/lab"
            element={
              <SearchScreen tripRequired={false}>
                <LabPage />
              </SearchScreen>
            }
          />
        )}
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route
          path="/account/*"
          element={
            <RequireAuth role="user">
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="/host/*"
          element={
            <RequireAuth role="host">
              <HostAccountPage />
            </RequireAuth>
          }
        />
        <Route path="/stays" element={<ListingsPage />} />
        <Route path="/stays/:id" element={<ListingPage />} />
        <Route
          path="*"
          element={
            <div className="page page-not-found">
              <h1>Страница не найдена</h1>
              <p>Проверьте ссылку или начните новую поездку.</p>
              <Link className="button primary" to="/">
                На главную
              </Link>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
