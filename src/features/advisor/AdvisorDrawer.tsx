import { Link } from "react-router-dom";
import type { SearchResult, Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { AdvisorPanel } from "./AdvisorPanel";
import { advisorTripKey } from "./useAdvisor";
import { useAuth } from "../auth/AuthProvider";

/** The dialog remains mounted when closed so an active analysis is not discarded. */
export function AdvisorDrawer({
  open,
  onClose,
  trip,
  result,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  trip: Trip;
  result: SearchResult | null;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const identity = user ? `account:${user.id}` : "anonymous";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI-помощник"
      className="search-advisor-drawer"
    >
      {result ? (
        <AdvisorPanel
          key={`${identity}:${advisorTripKey(trip)}:${result.searchId}`}
          trip={trip}
          searchId={result.searchId}
          noMatches={!result.results.length}
          needsClarification={!!result.conflicts.length}
          onRefreshSearch={onRefresh}
        />
      ) : (
        <div className="search-advisor-empty">
          <h3>Как вы хотите отдохнуть?</h3>
          <p>
            Выберите даты и гостей, затем запустите поиск. Помощник сравнит
            найденные варианты и объяснит, что стоит уточнить.
          </p>
          <Link to="/trip" className="button primary">
            Выбрать даты
          </Link>
        </div>
      )}
    </Modal>
  );
}
