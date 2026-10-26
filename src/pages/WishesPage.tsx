import { useApp } from "../app/providers/TripProvider";
import { useNavigate, Link } from "react-router-dom";
import { scenarios, features, featureIds } from "../../shared/features";
import { Steps } from "../app/layout/Steps";
import { TripSummary } from "../features/trip/components/TripSummary";
import {
  Waves,
  UsersRound,
  Moon,
  Check,
  ArrowLeft,
  Search,
  Heart,
  CheckCircle2,
} from "lucide-react";
import { PreferencePicker } from "../features/preferences/PreferencePicker";
import { editPreferences } from "../features/search/preferences";

export function WishesPage() {
  const { trip, setTrip, effectivePreferences } = useApp();
  const navigate = useNavigate();
  const suggested = [
    ...new Set([
      ...trip.scenarios.flatMap(
        (id) => scenarios.find((s) => s.id === id)?.features || [],
      ),
    ]),
  ];
  return (
    <div className="page">
      <Steps current={1} />
      <TripSummary trip={trip} />
      <div className="section-intro">
        <h1>Как хочется отдохнуть?</h1>
        <p className="lead">
          Выберите близкие вам варианты. Можно несколько — или сразу к отелям.
        </p>
      </div>
      <div className="wishes-layout">
        <section>
          <div className="scenario-grid">
            {scenarios.map((s, i) => {
              const Icon = [Waves, UsersRound, Moon][i];
              const selected = trip.scenarios.includes(s.id);
              return (
                <button
                  type="button"
                  className={`scenario ${selected ? "selected" : ""}`}
                  key={s.id}
                  aria-pressed={selected}
                  onClick={() =>
                    setTrip({
                      ...trip,
                      scenarios: selected
                        ? trip.scenarios.filter((x) => x !== s.id)
                        : [...trip.scenarios, s.id],
                    })
                  }
                >
                  <span className="scenario-icon">
                    <Icon size={27} />
                  </span>
                  <span className="scenario-text">
                    <strong>{s.title}</strong>
                    <small>{s.description}</small>
                  </span>
                  <span className="round-check">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="subsection">
            <h2>Что особенно важно?</h2>
            <p>Сценарий предлагает пожелания. Вы решаете, какие учитывать.</p>
            <PreferencePicker
              preferences={effectivePreferences}
              ids={[...new Set([...suggested, ...featureIds])]}
              onChange={(preferences) => setTrip(editPreferences(trip, preferences, effectivePreferences))}
            />
          </div>
          <label className="field text-field">
            <span>
              Есть особое пожелание? <small>Необязательно</small>
            </span>
            <textarea
              rows={3}
              maxLength={1500}
              value={trip.text}
              onChange={(e) => setTrip({ ...trip, text: e.target.value })}
              placeholder="Например: ребёнок спит днём, нужен номер во двор"
            />
            <small>
              Тишина внутри номера не определяется одной стороной окон. Мы
              покажем ограничения проверки.
            </small>
          </label>
          <div className="actions">
            <Link to="/" className="button secondary">
              <ArrowLeft size={17} />
              Назад
            </Link>
            <button
              type="button"
              className="button primary"
              onClick={() => navigate("/results")}
            >
              Показать отели <Search size={18} />
            </button>
          </div>
        </section>
        <aside className="side-note">
          <span className="note-icon">
            <Heart size={25} />
          </span>
          <h3>У каждого свой идеальный отдых</h3>
          <p>
            Кому-то нужен короткий путь к морю. Кому-то — номер во двор и
            дневной сон ребёнка.
          </p>
          <hr />
          <p>
            Мы проверим, совпадают ли ваши пожелания в одном номере, и расскажем
            о компромиссах.
          </p>
          <div className="small-note">
            <CheckCircle2 size={18} />
            Можно ничего не писать
          </div>
        </aside>
      </div>
    </div>
  );
}
