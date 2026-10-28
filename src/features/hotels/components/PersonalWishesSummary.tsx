import { Check, CircleHelp, MessageCircle, Minus, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { HotelMatch } from "../../../../shared/types";
import { personalWishSummary, type PersonalWishState } from "../../../shared/lib/personalWishes";

const states: { state: PersonalWishState; label: string }[] = [
  { state: "mismatch", label: "Не соответствует" },
  { state: "unknown", label: "Нужно уточнить" },
  { state: "reported", label: "Со слов отельера" },
  { state: "match", label: "Соответствует по данным" },
  { state: "excluded", label: "В тексте отменено" },
];

export function PersonalWishesSummary({ match }: { match: HotelMatch }) {
  const summary = personalWishSummary(match);
  if (!summary) return null;
  const Icon = summary.tone === "match" ? Check : summary.tone === "mismatch" ? X
    : summary.tone === "reported" ? MessageCircle : CircleHelp;
  return (
    <footer className={`personal-wishes personal-wishes-${summary.tone}`} aria-label="Личные пожелания">
      <div className="personal-wishes-heading">
        <Icon size={18} aria-hidden="true" />
        <strong>{summary.title}</strong>
      </div>
      {summary.items.length > 0 && (
        <ul className="personal-wishes-items">
          {states.map(({ state, label }) => {
            const items = summary.items.filter((item) => item.state === state);
            return items.length > 0 && (
              <li key={state}>
                {state === "excluded" && <Minus size={14} aria-hidden="true" />}
                <span><b>{label}:</b> {items.map((item) => item.label).join("; ")}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="personal-wishes-note">{summary.note}</p>
      {match.personalWishes?.status === "unrecognized" && !match.locationCriteria?.length && (
        <Link to="/wishes" className="personal-wishes-edit">Уточнить пожелание</Link>
      )}
    </footer>
  );
}
