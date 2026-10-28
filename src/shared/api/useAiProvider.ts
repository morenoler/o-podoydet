import { useSyncExternalStore } from "react";
import { getAiProvider, subscribeAiProvider } from "./aiProvider";

export function useAiProvider() {
  return useSyncExternalStore(subscribeAiProvider, getAiProvider, () => null);
}
