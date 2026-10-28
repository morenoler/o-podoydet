import type { Trip } from "./types";

export type ShortlistStage = "considering" | "clarify" | "availability" | "chosen";
export interface FavoriteItem {
  id: string;
  name: string;
  path: string;
  hotelId?: string;
  photos?: string[];
  address?: string;
  note?: string;
  stage?: ShortlistStage;
  savedAt?: string;
}
export interface Shortlist {
  title: string;
  trip: Trip | null;
  items: FavoriteItem[];
  revision: number;
  updatedAt: string | null;
  shareActive?: boolean;
}
export interface SharedShortlist {
  title: string;
  trip: Pick<Trip, "region" | "checkIn" | "checkOut" | "adults" | "children" | "preferences"> | null;
  items: Pick<FavoriteItem, "id" | "name" | "path" | "hotelId" | "photos" | "address">[];
  sharedAt: string;
  expiresAt: string;
}
export const shortlistStages: Record<ShortlistStage, string> = {
  considering: "Рассматриваю",
  clarify: "Уточнить условия",
  availability: "Узнать цену и наличие",
  chosen: "Мой выбор",
};
