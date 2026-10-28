import { ArrowRight, FlaskConical } from "lucide-react";
import type { Hotel, Trip } from "../../../shared/types";

/** This preset exercises capacity as well as evidence edge cases in the fixtures. */
export function listingTestTrip(trip: Trip): Trip {
  return {
    ...trip,
    admissionMode: "verified",
    adults: 2,
    children: 1,
    scenarios: [],
    text: "",
    preferences: [
      { feature: "courtyard", required: true },
      { feature: "family", required: true },
    ],
  };
}

/** Keep the strict test identical except for courtyard priority. */
export function listingComparisonTrip(trip: Trip): Trip {
  const strict = listingTestTrip(trip);
  return {
    ...strict,
    preferences: strict.preferences.map((preference) =>
      preference.feature === "courtyard"
        ? { ...preference, required: false }
        : preference,
    ),
  };
}

const caseLabels: Record<string, string> = {
  "lab-demo-match": "Условия выполнены",
  "lab-demo-mismatch": "Условие не выполнено",
  "lab-demo-unknown": "Данных недостаточно",
  "lab-demo-stale": "Сведения устарели",
  "lab-demo-conflict": "Источники противоречат",
  "lab-demo-capacity": "Не хватает мест",
};

export function LabListings({
  hotels,
  disabled,
  onOpen,
  onApply,
  onCompare,
}: {
  hotels: Hotel[];
  disabled: boolean;
  onOpen: (hotelId: string) => void;
  onApply: () => void;
  onCompare?: () => void;
}) {
  const listings = hotels.filter((hotel) => hotel.id.startsWith("lab-demo-"));
  if (!listings.length) return null;
  return (
    <section
      className="lab-listings"
      id="lab-listings"
      aria-labelledby="lab-listings-heading"
    >
      <div className="lab-section-heading">
        <div>
          <h2 id="lab-listings-heading">
            Тестовые объявления · {listings.length}
          </h2>
          <p className="lab-muted">
            Разные ситуации для проверки подбора и объяснений агентов.
          </p>
        </div>
        <span className="lab-fiction">
          <FlaskConical size={14} aria-hidden="true" />
          Полностью вымышленные
        </span>
      </div>
      <p className="lab-listings-notice">
        Названия, категории и доказательства созданы для теста. Это не реальные
        предложения размещения. Тестовые ответы отельера могут менять только
        подбор этой копии.
      </p>
      <div className="lab-listings-grid">
        {listings.map((hotel) => (
          <article className="lab-listing" key={hotel.id}>
            <span className="lab-listing-case">
              {caseLabels[hotel.id] || "Тестовый сценарий"}
            </span>
            <h3>{hotel.name}</h3>
            <p>
              {hotel.dataNotes?.[0] ||
                "Вымышленное объявление для проверки поведения системы."}
            </p>
            <span className="lab-listing-room">
              {hotel.rooms[0]?.name || "Категория для теста"}
              {hotel.rooms[0]?.capacity
                ? ` · до ${hotel.rooms[0].capacity} гостей`
                : ""}
            </span>
            <button
              type="button"
              className="text-link"
              disabled={disabled}
              onClick={() => onOpen(hotel.id)}
              aria-label={`Проверить объявление: ${hotel.name}`}
            >
              Проверить объявление <ArrowRight size={15} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      <div className="lab-listings-preset">
        <div className="lab-experiment-details">
          <strong>Опыт 1. Проверить обязательные условия</strong>
          <p>
            Двое взрослых и ребёнок. Семейная категория и окна во двор
            обязательны. Даты остаются выбранными в форме.
          </p>
          <p>
            В исходных тестовых данных обычно проходит одно объявление. Если
            Java оставила одного кандидата, у ИИ нет выбора между
            альтернативами: этот опыт проверяет исключения и ограничения.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={onApply}
        >
          Подобрать по тестовым условиям
        </button>
      </div>
      {onCompare && (
        <div className="lab-listings-preset">
          <div className="lab-experiment-details">
            <strong>Опыт 2. Проверить выбор и критику ИИ</strong>
            <p>
              Те же двое взрослых и ребёнок. Семейная категория остаётся
              обязательной, окна во двор становятся желательными.
            </p>
            <p>
              Объявления с отсутствующими, устаревшими и противоречивыми
              сведениями о дворе могут остаться в списке. Проверьте, кого выбрал
              агент отбора и какие проблемы отметил проверяющий.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={onCompare}
          >
            Проверить выбор и критику ИИ
          </button>
        </div>
      )}
      <p className="lab-experiment-note">
        Эти два опыта используют только шесть вымышленных объявлений. Обычные
        кнопки запуска в форме ниже проверяют весь каталог. Сохранённые ответы
        отельера могут менять ожидаемый результат теста. Если модель
        не подключена, запуск выполняется по правилам и так помечается.
      </p>
    </section>
  );
}
