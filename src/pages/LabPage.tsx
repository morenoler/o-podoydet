import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";
import type { Trip } from "../../shared/types";
import { advisorModeLabel } from "../../shared/advisor";
import { useApp } from "../app/providers/TripProvider";
import { PreferencePicker } from "../features/preferences/PreferencePicker";
import { ErrorMessage } from "../shared/ui/Feedback";
import { today } from "../shared/lib/date";
import { useLab } from "../features/lab/useLab";
import { AiProviderSelect } from "../shared/ui/AiProviderSelect";
import { useAiProvider } from "../shared/api/useAiProvider";
import { executionLabel, LabRunView } from "../features/lab/LabRunView";
import { advisorIsActive } from "../features/advisor/useAdvisor";
import {
  LabListings,
  listingTestTrip,
  listingComparisonTrip,
} from "../features/lab/LabListings";
import { LabGuide } from "../features/lab/LabGuide";
import "../features/advisor/advisor.css";
import "../features/lab/lab.css";
import "../features/lab/guide.css";

function dateAfter(days: number) {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function preset(kind: "fit" | "none" | "conflict"): Trip {
  const base: Trip = {
    region: "Пусан",
    checkIn: dateAfter(1),
    checkOut: dateAfter(4),
    adults: 2,
    children: 0,
    scenarios: [],
    preferences: [],
    text: "",
  };
  if (kind === "fit")
    base.preferences = [{ feature: "beach_walk", required: false }];
  if (kind === "none")
    base.preferences = [{ feature: "area_safety", required: true }];
  if (kind === "conflict") {
    base.preferences = [{ feature: "family", required: true }];
    base.text = "Семейный отдых не нужен.";
  }
  return base;
}

export function LabPage() {
  const { catalog, setTrip } = useApp();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Trip>(() => preset("fit"));
  const [formError, setFormError] = useState("");
  const lab = useLab();
  const selectedProvider = useAiProvider();
  const locked = !!lab.busy || !!lab.active;
  const chosen = selectedProvider ?? lab.config?.defaultMode;
  const modelMode = chosen && chosen !== "rules" && lab.config?.modes.includes(chosen) ? chosen : undefined;
  const local =
    lab.selected && lab.selected.mode !== "rules"
      ? lab.selected
      : lab.runs.find(
          (run) =>
            run.context.searchId === lab.selected?.context.searchId &&
            run.mode !== "rules",
        );
  const counterpart = lab.selected
    ? lab.runs.find(
        (run) =>
          run.id !== lab.selected!.id &&
          run.context.searchId === lab.selected!.context.searchId &&
          (run.mode === "rules") !== (lab.selected!.mode === "rules"),
      )
    : undefined;
  const verifiedHotels =
    catalog?.hotels.filter(
      (hotel) =>
        !hotel.id.startsWith("lab-demo-") &&
        hotel.rooms.some(
          (room) => !room.demo && room.evidenceStatus === "verified",
        ),
    ).length || 0;
  const verifiedRooms =
    catalog?.hotels
      .flatMap((hotel) => hotel.rooms)
      .filter((room) => !room.demo && room.evidenceStatus === "verified")
      .length || 0;

  function valid() {
    if (!draft.checkIn || !draft.checkOut || draft.checkOut <= draft.checkIn) {
      setFormError("Выезд должен быть позже заезда.");
      return false;
    }
    if (
      !Number.isInteger(draft.adults) ||
      draft.adults < 1 ||
      draft.adults > 6 ||
      !Number.isInteger(draft.children) ||
      draft.children < 0 ||
      draft.children > 4
    ) {
      setFormError("Укажите от 1 до 6 взрослых и от 0 до 4 детей.");
      return false;
    }
    setFormError("");
    return true;
  }
  function openResults() {
    if (!valid()) return;
    setTrip(draft);
    navigate("/results");
  }
  function openListing(hotelId: string) {
    if (!valid()) return;
    setTrip(draft);
    navigate(`/hotels/${encodeURIComponent(hotelId)}`);
  }
  function applyListingPreset() {
    if (!valid()) return;
    const testTrip = listingTestTrip(draft);
    setDraft(testTrip);
    setTrip(testTrip);
    void lab.start(
      testTrip,
      modelMode ?? "rules",
      undefined,
      true,
    );
    document.getElementById("lab-workbench")?.scrollIntoView();
  }
  function applyComparisonPreset() {
    if (!valid()) return;
    const testTrip = listingComparisonTrip(draft);
    setDraft(testTrip);
    setTrip(testTrip);
    void lab.start(
      testTrip,
      modelMode ?? "rules",
      undefined,
      true,
    );
    document.getElementById("lab-workbench")?.scrollIntoView();
  }

  return (
    <div className="page lab-page">
      <header className="lab-heading">
        <div>
          <span className="lab-clone">
            <FlaskConical size={16} aria-hidden="true" />
            Тестовая копия сайта
          </span>
          <h1>Посмотрите, как принимается решение</h1>
          <p>
            Меняйте поездку, запускайте модель и проверяйте каждый переход
            от условий до ответа.
          </p>
        </div>
        <Link to="/" className="button secondary">
          Обычный интерфейс <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>
      <div className="lab-data-strip">
        <span>
          <strong>{catalog?.hotels.length ?? "—"}</strong> объектов в каталоге
        </span>
        <span>
          <strong>{verifiedHotels}</strong> с подтверждёнными категориями
        </span>
        <span>
          <strong>{verifiedRooms}</strong> подтверждённых категорий
        </span>
        <span className="lab-free">{modelMode === "deepseek" ? "DeepSeek · платные запросы API" : "Без платных API"}</span>
      </div>
      {catalog?.evidencePolicy === "demo" && (
        <div className="notice lab-catalog-notice">
          <FlaskConical size={19} aria-hidden="true" />
          <span>
            В этой копии включён тестовый каталог: реальные объекты дополнены
            вымышленными объявлениями. Демонстрационные факты участвуют в
            тестовом подборе и не считаются проверенными сведениями о реальных
            отелях.
          </span>
        </div>
      )}
      <LabGuide />
      {catalog && (
        <LabListings
          hotels={catalog.hotels}
          disabled={locked}
          onOpen={openListing}
          onApply={applyListingPreset}
          onCompare={applyComparisonPreset}
        />
      )}
      {(lab.error || formError) && (
        <div className="lab-error">
          <ErrorMessage text={formError || lab.error} />
          <button
            className="button secondary"
            type="button"
            onClick={lab.reload}
            disabled={!!lab.busy}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Обновить состояние
          </button>
        </div>
      )}
      <div className="lab-workbench" id="lab-workbench">
        <aside className="lab-controls">
          <section className="lab-input-panel">
            <div className="lab-section-heading">
              <h2>Сценарий поездки</h2>
              <span>Пусан</span>
            </div>
            <div className="lab-presets" aria-label="Готовые сценарии">
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraft(preset("fit"))}
              >
                Есть варианты
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraft(preset("none"))}
              >
                Нет совпадений
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraft(preset("conflict"))}
              >
                Конфликт пожеланий
              </button>
            </div>
            <p className="lab-muted">
              Пресеты задают условия. Результат рассчитывается по текущим
              данным.
            </p>
            <fieldset className="lab-fields" disabled={locked}>
              <legend className="lab-sr-only">
                Параметры тестовой поездки
              </legend>
              <div className="lab-form-grid">
                <label className="field">
                  <span>Заезд</span>
                  <input
                    type="date"
                    value={draft.checkIn}
                    onChange={(event) =>
                      setDraft({ ...draft, checkIn: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Выезд</span>
                  <input
                    type="date"
                    value={draft.checkOut}
                    min={draft.checkIn}
                    onChange={(event) =>
                      setDraft({ ...draft, checkOut: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Взрослые</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={draft.adults}
                    onChange={(event) =>
                      setDraft({ ...draft, adults: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Дети</span>
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={draft.children}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        children: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Пожелание своими словами</span>
                <textarea
                  rows={2}
                  value={draft.text}
                  maxLength={1500}
                  onChange={(event) =>
                    setDraft({ ...draft, text: event.target.value })
                  }
                />
              </label>
              <details className="lab-preferences" open>
                <summary>
                  Условия и обязательность · {draft.preferences.length}
                </summary>
                <PreferencePicker
                  preferences={draft.preferences}
                  onChange={(preferences) =>
                    setDraft({ ...draft, preferences })
                  }
                />
              </details>
            </fieldset>
            <AiProviderSelect disabled={locked} />
            <div className="lab-actions">
              <button
                type="button"
                className="button primary"
                disabled={locked || !modelMode}
                onClick={() => {
                  if (valid() && modelMode) void lab.start(draft, modelMode);
                }}
              >
                <Play size={16} aria-hidden="true" />
                Запустить {modelMode ? advisorModeLabel(modelMode) : "модель"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={locked || !lab.config}
                onClick={() => {
                  if (valid()) void lab.start(draft, "rules");
                }}
              >
                Проверить без ИИ
              </button>
              {lab.active && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!lab.busy}
                  onClick={() => void lab.cancel()}
                >
                  <Square size={14} aria-hidden="true" />
                  Остановить запуск
                </button>
              )}
            </div>
            {lab.busy && (
              <p role="status" className="lab-muted">
                {lab.busy}
              </p>
            )}
            <p className="lab-model">
              {modelMode && lab.config
                ? `Модель: ${lab.config.modelNames?.[modelMode] ?? lab.config.model}. До ${lab.config.maxModelCalls} вызовов за запуск.`
                : "Модель не выбрана или не настроена. Проверка без ИИ доступна."}
            </p>
            <button
              type="button"
              className="lab-text-button"
              onClick={openResults}
            >
              Открыть эти условия в обычном подборе{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </section>
          <section className="lab-history">
            <h2>Запуски лаборатории</h2>
            {lab.runs.length === 0 && (
              <p className="lab-muted">
                История появится после первой проверки.
              </p>
            )}
            <ul>
              {lab.runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className={lab.selected?.id === run.id ? "selected" : ""}
                    onClick={() => lab.select(run.id)}
                    aria-pressed={lab.selected?.id === run.id}
                  >
                    <strong>
                      {advisorModeLabel(run.mode)} ·{" "}
                      {new Date(run.createdAt).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </strong>
                    <span>
                      {run.context.fitCount} прошли условия ·{" "}
                      {run.status === "completed"
                        ? "завершён"
                        : run.status === "running"
                          ? "в работе"
                          : run.status === "failed"
                            ? "ошибка"
                            : run.status === "cancelled"
                              ? "остановлен"
                              : "в очереди"}
                    </span>
                    <small>{executionLabel(run)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <div className="lab-main">
          {lab.selected ? (
            <>
              <div className="lab-compare-action">
                <div>
                  <strong>Сравнение на одинаковых данных</strong>
                  <p>
                    Контрольный запуск использует тот же снимок подбора, что и
                    выбранный ИИ-запуск.
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={locked || !local || advisorIsActive(local)}
                  onClick={() => {
                    if (local)
                      void lab.start(
                        local.context.trip,
                        "rules",
                        local.context.searchId,
                      );
                  }}
                >
                  Сравнить с правилами
                </button>
              </div>
              <LabRunView
                key={lab.selected.id}
                run={lab.selected}
                counterpart={counterpart}
              />
            </>
          ) : (
            <section className="lab-empty">
              <div className="lab-empty-route">
                <ClipboardIcon />
                <ArrowRight size={24} aria-hidden="true" />
                <FlaskConical size={40} aria-hidden="true" />
                <ArrowRight size={24} aria-hidden="true" />
                <ShieldIcon />
              </div>
              <h2>Один запуск. Весь путь решения.</h2>
              <p>
                Выберите сценарий слева. Здесь появятся реальные входные данные,
                работа двух агентов модели, проверка результата и ответ
                пользователю.
              </p>
              <div className="lab-empty-note">
                <strong>Правила и ИИ будут видны отдельно.</strong>
                <span>
                  При ошибке модели резервный ответ не будет выдаваться за
                  успешную работу ИИ.
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
      <section className="lab-other">
        <div className="lab-section-heading">
          <h2>Другие проверки сайта</h2>
          <span>Все страницы доступны в этой копии</span>
        </div>
        <div className="lab-other-grid">
          <button type="button" onClick={openResults}>
            <strong>Подбор и сравнение</strong>
            <span>
              Открыть текущие условия, выбрать до трёх отелей и сравнить
              критерии.
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={openResults}>
            <strong>Карты и доказательства</strong>
            <span>
              Из выдачи открыть отель: маршрут, район, категория и источники.
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <Link to="/host">
            <strong>Кабинет отельера</strong>
            <span>
              {catalog?.evidencePolicy === "demo"
                ? "Проверить цикл вопроса и ответа. Тестовые ответы меняют только подбор этой копии."
                : "Проверить цикл вопроса и ответа. Ответы демонстрационные, подбор не меняют."}
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <p className="lab-muted">
          Цены, наличие на даты и бронирование не подключены. Заметки и история
          лаборатории относятся к этой копии сайта.
        </p>
      </section>
    </div>
  );
}
function ClipboardIcon() {
  return <ClipboardList size={40} aria-hidden="true" />;
}
function ShieldIcon() {
  return <ShieldCheck size={40} aria-hidden="true" />;
}
