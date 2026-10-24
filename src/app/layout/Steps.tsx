import { Check, ChevronRight } from "lucide-react";

export function Steps({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="Шаги подбора">
      {["Куда и когда", "Что вам важно", "Ваши отели"].map((label, i) => (
        <li
          key={label}
          className={i === current ? "current" : i < current ? "complete" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{i < current ? <Check size={14} /> : i + 1}</span>
          {label}
          {i < 2 && <ChevronRight size={15} className="step-arrow" />}
        </li>
      ))}
    </ol>
  );
}
