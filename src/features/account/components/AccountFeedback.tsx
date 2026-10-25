import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { ErrorMessage } from "../../../shared/ui/Feedback";

export function AccountLoading({
  text = "Загружаем данные…",
}: {
  text?: string;
}) {
  return (
    <div className="account-loading" role="status">
      <span className="spinner" />
      {text}
    </div>
  );
}
export function ResourceError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="account-stack">
      <ErrorMessage text={error} />
      <button type="button" className="button secondary" onClick={onRetry}>
        Повторить загрузку
      </button>
    </div>
  );
}
export function AccountEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="account-empty">
      <span className="account-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SaveStatus({ children }: { children: ReactNode }) {
  return (
    <p className="account-success" role="status">
      {children}
    </p>
  );
}

export function AccountCallout({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="account-callout">
      <Info size={23} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
