import { createElement, type ReactNode } from "react";
import { TripProvider } from "../../src/app/providers/TripProvider";
import { AuthProvider } from "../../src/features/auth/AuthProvider";
import { FavoritesProvider } from "../../src/features/favorites/FavoritesProvider";

/** Mirror the application's provider tree when rendering a card in isolation. */
export function FavoritesTestProvider({ children }: { children?: ReactNode }) {
  return createElement(AuthProvider, { children: createElement(TripProvider, { children: createElement(FavoritesProvider, { children }) }) });
}
