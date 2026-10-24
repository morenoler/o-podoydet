import { AlertTriangle, Info } from "lucide-react";
import { type ReactNode } from "react";

export function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="notice error" role="alert">
      <AlertTriangle size={18} />
      <span>{text}</span>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Info size={18} />
      <span>{children}</span>
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Проверяем подходящие варианты…
    </div>
  );
}
