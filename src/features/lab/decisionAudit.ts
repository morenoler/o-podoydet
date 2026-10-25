import type { AdvisorDiagnostic, AdvisorRun } from "../../../shared/advisor";

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function modelCandidates(call?: AdvisorDiagnostic) {
  const candidates = record(call?.input).candidates;
  return Array.isArray(candidates) ? candidates.map(record) : [];
}

export function selectedReferences(run: AdvisorRun) {
  const call = run.diagnostics?.find((item) => item.agent === "selector");
  return strings(record(call?.output).candidateIds).map((alias) => {
    const id = call?.references?.candidates[alias];
    const candidate = run.context.candidates.find((item) => item.id === id);
    return { alias, id, candidate };
  });
}

export interface EvidenceAudit {
  key: string;
  candidateName: string;
  label: string;
  status: string;
  assumed: boolean;
  required: boolean;
  needsWarning: boolean;
  modelMarked: boolean | null;
  finalMarked: boolean | null;
  difference: "missed" | "extra" | "agrees" | "pending";
}

/** Compare observable responses, never reconstruct a model's hidden reasoning. */
export function evidenceAudit(run: AdvisorRun): EvidenceAudit[] {
  const call = run.diagnostics?.find((item) => item.agent === "critic");
  if (!call) return [];
  const cautions = record(call.output).cautions;
  const outputKnown =
    Array.isArray(cautions) ||
    (cautions !== null && typeof cautions === "object");
  return modelCandidates(call).flatMap((candidate) => {
    const alias = String(candidate.id ?? "?");
    const candidateId = call.references?.candidates[alias];
    const original = run.context.candidates.find(
      (item) => item.id === candidateId,
    );
    const marked = Array.isArray(cautions)
      ? cautions
          .map(record)
          .filter((item) => item.candidateId === alias)
          .flatMap((item) => strings(item.evidenceIds))
      : strings(record(cautions)[alias]);
    const criteria = Array.isArray(candidate.criteria)
      ? candidate.criteria.map(record)
      : [];
    return criteria.map((criterion): EvidenceAudit => {
      const evidenceAlias = String(criterion.id ?? "?");
      const reference = call.references?.evidence[evidenceAlias];
      const evidenceId =
        reference && reference[0] === candidateId ? reference[1] : undefined;
      const evidence = original?.criteria.find(
        (item) => item.id === evidenceId,
      );
      const needsWarning =
        criterion.assumed === true ||
        criterion.status !== "match" ||
        criterion.evidenceStatus !== "match";
      const modelMarked = outputKnown ? marked.includes(evidenceAlias) : null;
      const finalMarked =
        run.status === "completed" && run.report && candidateId && evidenceId
          ? !!run.report.cautions
              .find((item) => item.candidateId === candidateId)
              ?.evidenceIds.includes(evidenceId)
          : null;
      return {
        key: `${alias}/${evidenceAlias}`,
        candidateName:
          original?.hotelName || String(candidate.hotelName || alias),
        label:
          evidence?.label ||
          `${String(criterion.feature || "Условие")} · ${evidenceAlias}`,
        status: String(criterion.evidenceStatus ?? "unknown"),
        assumed: criterion.assumed === true,
        required: criterion.required === true,
        needsWarning,
        modelMarked,
        finalMarked,
        difference:
          modelMarked === null
            ? "pending"
            : modelMarked === needsWarning
              ? "agrees"
              : needsWarning
                ? "missed"
                : "extra",
      };
    });
  });
}
