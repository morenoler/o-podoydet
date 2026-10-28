import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdvisorConfig,
  AdvisorMode,
  AdvisorRun,
} from "../../../shared/advisor";
import type { Trip } from "../../../shared/types";
import { api } from "../../shared/api/client";

export const advisorIsActive = (run: AdvisorRun | null) =>
  run?.status === "queued" || run?.status === "running";

/** Field order from JSON transport does not affect exact trip identity. */
export function advisorTripKey(trip: Trip) {
  return JSON.stringify([
    trip.region,
    trip.checkIn,
    trip.checkOut,
    trip.adults,
    trip.children,
    trip.scenarios,
    trip.preferences.map(({ feature, required }) => [feature, required]),
    trip.text,
    trip.preferenceOverrides?.map(({ feature, required, enabled }) => [feature, required, enabled]),
    trip.admissionMode || "verified",
    trip.hotelFilters?.query || "",
    [...(trip.hotelFilters?.lodgingTypes || [])].sort(),
    trip.hotelFilters?.maxPricePerNight ?? null,
    trip.hotelFilters?.maxBeachMeters ?? null,
    [...(trip.hotelFilters?.nearby || [])].sort((a, b) => a.kind.localeCompare(b.kind)).map(({ kind, maxMeters }) => [kind, maxMeters]),
  ]);
}

export function useAdvisor(trip: Trip, searchId?: string) {
  const tripKey = advisorTripKey(trip);
  const [config, setConfig] = useState<AdvisorConfig | null>(null);
  const [storedRun, setRun] = useState<AdvisorRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const latestRun = useRef<AdvisorRun | null>(null);
  const run =
    storedRun &&
    searchId &&
    storedRun.context.searchId === searchId &&
    advisorTripKey(storedRun.context.trip) === tripKey
      ? storedRun
      : null;
  latestRun.current = run;

  const remember = useCallback((next: AdvisorRun) => {
    setRun((previous) => {
      if (previous?.id === next.id) {
        // An in-flight poll must not revive work after cancellation or completion.
        if (!advisorIsActive(previous) && advisorIsActive(next))
          return previous;
        if (Date.parse(previous.updatedAt) > Date.parse(next.updatedAt))
          return previous;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = latestRun.current;
      if (active && advisorIsActive(active)) {
        // Leaving this trip stops now-irrelevant work, including local inference.
        void api(
          `/advisor/runs/${encodeURIComponent(active.id)}/cancel`,
          {},
        ).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<AdvisorConfig>("/advisor/config"),
      searchId ? api<AdvisorRun[]>("/advisor/runs") : Promise.resolve([]),
    ])
      .then(([nextConfig, runs]) => {
        if (!current) return;
        setConfig(nextConfig);
        const relevant = runs
          .filter(
            (item) =>
              advisorIsActive(item) &&
              item.context.searchId === searchId &&
              advisorTripKey(item.context.trip) === tripKey,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRun(relevant[0] || null);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось подключить помощника.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [tripKey, searchId, revision]);

  const pollingId = advisorIsActive(run) ? run?.id : undefined;
  useEffect(() => {
    if (!pollingId || loading) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const next = await api<AdvisorRun>(
          `/advisor/runs/${encodeURIComponent(pollingId)}`,
        );
        if (
          !current ||
          next.context.searchId !== searchId ||
          advisorTripKey(next.context.trip) !== tripKey
        )
          return;
        remember(next);
        if (advisorIsActive(next)) {
          if (++attempts >= 320) {
            setError(
              "Ожидание затянулось. Обновите состояние помощника или остановите проверку.",
            );
            return;
          }
          timer = setTimeout(poll, 1500);
        }
      } catch (cause) {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Связь с помощником прервалась.",
          );
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pollingId, loading, tripKey, searchId, revision, remember]);

  async function action(path: string, body: unknown, kind: "start" | "cancel") {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    setError("");
    try {
      const next = await api<AdvisorRun>(path, body);
      if (!mounted.current) {
        if (kind === "start" && advisorIsActive(next))
          void api(
            `/advisor/runs/${encodeURIComponent(next.id)}/cancel`,
            {},
          ).catch(() => {});
        return;
      }
      if (
        next.context.searchId === searchId &&
        advisorTripKey(next.context.trip) === tripKey
      )
        remember(next);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось выполнить действие.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy("");
    }
  }

  return {
    config,
    run,
    loading,
    busy,
    error,
    reload: () => setRevision((value) => value + 1),
    start: (mode: AdvisorMode) =>
      searchId
        ? action("/advisor/runs", { trip, searchId, mode }, "start")
        : Promise.resolve(),
    cancel: () =>
      run
        ? action(
            `/advisor/runs/${encodeURIComponent(run.id)}/cancel`,
            {},
            "cancel",
          )
        : Promise.resolve(),
  };
}
