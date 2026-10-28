import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../../app/providers/TripProvider";
import { useAuth } from "../../auth/AuthProvider";
import { SearchConversation } from "../../advisor/SearchConversation";

export function DetailSidebar({ hotelId, region, map }: { hotelId: string; region?: string; map: ReactNode }) {
  const { trip, setTrip } = useApp();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mapView, setMapView] = useState(true);
  const scope = `detail:${user?.id || "guest"}:${hotelId}`;
  if (loading || (region && region !== trip.region)) return <div className="figcraft-detail-sidebar-loading" role="status">Открываем карту и помощника…</div>;
  return <SearchConversation key={`${scope}:${trip.region}`} scope={scope} contextHotelId={hotelId}
    trip={trip} onApply={(next) => { setTrip(next); if (next.region !== trip.region) navigate("/results"); }}
    result={null} searching={false} searchError="" onAnalyze={() => navigate("/results")}
    mapView={mapView} onMapViewChange={setMapView} map={map} />;
}
