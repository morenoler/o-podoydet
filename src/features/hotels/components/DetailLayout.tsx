import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "../figcraft-detail.css";

/** Geometry follows the supplied FigCraft detail frame; content remains source-backed. */
export function DetailLayout({ backTo, gallery, saved, sidebar, children }: {
  backTo: string; gallery: ReactNode; saved: ReactNode; sidebar: ReactNode; children: ReactNode;
}) {
  return <div className="page figcraft-detail-page">
    <div className="figcraft-detail-grid">
      <div className="figcraft-detail-main">
        <div className="figcraft-detail-toolbar">
          <Link to={backTo} className="back-link"><ArrowLeft size={16} aria-hidden="true" />Назад</Link>
          {saved}
        </div>
        {gallery}
        <div className="figcraft-detail-panel">{children}</div>
      </div>
      <div className="figcraft-detail-sidebar">{sidebar}</div>
    </div>
  </div>;
}
