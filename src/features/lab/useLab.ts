import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdvisorConfig,
  AdvisorMode,
  AdvisorRun,
} from "../../../shared/advisor";
import type { SearchResult, Trip } from "../../../shared/types";
import { api } from "../../shared/api/client";
import { advisorIsActive } from "../advisor/useAdvisor";

const HISTORY_KEY = "o-lab-run-ids-v1";
function savedIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(0, 40)
      : [];
  } catch {
    return [];
  }
}

export function useLab() {
  const [config, setConfig] = useState<AdvisorConfig | null>(null);
  const [runs, setRuns] = useState<AdvisorRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const selected = runs.find((run) => run.id === selectedId) || null;
  const active = runs.find(advisorIsActive) || null;

  const remember = useCallback((next: AdvisorRun) => {
    setRuns((previous) => {
      const old = previous.find((run) => run.id === next.id);
      if (
        old &&
        ((!advisorIsActive(old) && advisorIsActive(next)) ||
          Date.parse(old.updatedAt) > Date.parse(next.updatedAt))
      )
        return previous;
      return [next, ...previous.filter((run) => run.id !== next.id)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 40);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    Promise.all([
      api<AdvisorConfig>("/advisor/config"),
      api<AdvisorRun[]>("/advisor/runs"),
    ])
      .then(([nextConfig, history]) => {
        if (!current) return;
        const ids = new Set(savedIds());
        const own = history.filter((run) => ids.has(run.id));
        setConfig(nextConfig);
        setRuns(own);
        setSelectedId((id) =>
          own.some((run) => run.id === id) ? id : own[0]?.id || "",
        );
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить лабораторию.",
          );
      });
    return () => {
      current = false;
    };
  }, [revision]);

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    let current = true;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<AdvisorRun>(
          `/advisor/runs/${encodeURIComponent(activeId)}`,
        );
        if (!current) return;
        remember(next);
        if (advisorIsActive(next)) {
          if (++count >= 320) {
            setError(
              "Автообновление остановлено после длительного ожидания. Обновите состояние или отмените запуск.",
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
              : "Связь с запуском прервалась.",
          );
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [activeId, revision, remember]);

  async function start(
    trip: Trip,
    mode: AdvisorMode,
    searchId?: string,
    testOnly = false,
  ) {
    if (pending.current || active) return;
    pending.current = true;
    setBusy(
      searchId ? "Сравниваем на том же подборе…" : "Java рассчитывает подбор…",
    );
    setError("");
    try {
      const snapshot =
        searchId ||
        (await api<SearchResult>(testOnly ? "/lab/search" : "/search", trip))
          .searchId;
      if (!snapshot)
        throw new Error(
          "Сервер не вернул идентификатор подбора. Перезапустите лабораторный сервер.",
        );
      if (!mounted.current) return;
      setBusy("Запускаем агентов…");
      const next = await api<AdvisorRun>("/advisor/runs", {
        trip,
        searchId: snapshot,
        mode,
      });
      const ids = [next.id, ...savedIds().filter((id) => id !== next.id)].slice(
        0,
        40,
      );
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(ids));
      } catch {
        /* Browsers may disable storage. */
      }
      if (!mounted.current) return;
      remember(next);
      setSelectedId(next.id);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось запустить проверку.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy("");
    }
  }

  async function cancel() {
    if (!active || pending.current) return;
    pending.current = true;
    setBusy("Останавливаем…");
    setError("");
    try {
      const next = await api<AdvisorRun>(
        `/advisor/runs/${encodeURIComponent(active.id)}/cancel`,
        {},
      );
      if (mounted.current) remember(next);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось остановить запуск.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy("");
    }
  }

  return {
    config,
    runs,
    selected,
    active,
    busy,
    error,
    select: setSelectedId,
    start,
    cancel,
    reload: () => {
      setError("");
      setRevision((value) => value + 1);
    },
  };
}
