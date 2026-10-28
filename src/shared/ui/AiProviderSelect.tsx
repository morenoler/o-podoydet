import { useEffect, useId, useState } from "react";
import { api } from "../api/client";
import { parseAiProvider, setAiProvider, type AiConfig } from "../api/aiProvider";
import { useAiProvider } from "../api/useAiProvider";
import "./AiProviderSelect.css";

export function AiProviderSelect({ disabled = false }: { disabled?: boolean }) {
  const selected = useAiProvider();
  const id = useId();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<AiConfig>("/ai/config", undefined, controller.signal)
      .then(setConfig).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить модели.");
      });
    return () => controller.abort();
  }, [revision]);
  const option = config?.providers.find(item => item.id === selected);
  const deepseek = (selected ?? config?.defaultProvider) === "deepseek";
  const hint = error || (selected && option && !option.available ? option.reason || "Эта модель сейчас не настроена на сервере." : deepseek ? "DeepSeek: текст запроса передаётся в API, запросы платные." : "Выбор применяется к следующим запросам.");
  return <div className="ai-provider-select">
    <label htmlFor={id}>Модель ИИ</label>
    <select id={id} value={selected ?? ""} disabled={disabled || !config} aria-describedby={`${id}-hint`}
      onChange={event => setAiProvider(parseAiProvider(event.target.value))}>
      <option value="">{config ? "Как на сервере" : "Загрузка моделей…"}</option>
      {(config?.providers ?? []).map(item => <option key={item.id} value={item.id} disabled={!item.available}>
        {item.label}{!item.available ? " · не настроено" : ""}
      </option>)}
    </select>
    <span id={`${id}-hint`} className="ai-provider-hint" role={error ? "alert" : "status"}>{hint}</span>
    {error && <button type="button" className="button secondary" onClick={() => retry(value => value + 1)}>Повторить</button>}
  </div>;
}
