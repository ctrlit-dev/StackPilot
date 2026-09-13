import type { ServiceId } from "../serviceId";

export type DiagnosticSeverity = "info" | "warning" | "error";

/**
 * A reference to an existing, already-registered VS Code command - never a
 * new command invented just to give a diagnostic a button. `label` is the
 * button text; `commandId` must be one of this extension's own `COMMAND_*`
 * constants (see constants.ts). No `args`: every action a check emits today
 * targets a zero-argument command, and adding an unused field speculatively
 * would be exactly the kind of premature generalization this model avoids.
 */
export interface DiagnosticAction {
  readonly label: string;
  readonly commandId: string;
}

/**
 * One concrete, user-facing finding. Deliberately small - every field earns
 * its place against an actual DIAGNOSTICS-1B check:
 *
 * - `code`: stable, dot-namespaced identifier (e.g. "python.interpreter.missing"),
 *   kept separate from `message` because message wording will be tuned over
 *   time while tests and any future tooling need something that does not.
 * - `severity`: "info" | "warning" | "error" only - there is no "success"
 *   value. A check that finds nothing wrong simply returns no result for
 *   that condition; a synthetic "all good" result would have no consumer.
 * - `message`: one user-facing string. No separate `title`/`description`
 *   split - the only surface planned for 1B has no need for two lengths yet.
 * - `serviceId`: optional; present when a result is about one specific
 *   detected service (backend/frontend), absent for a project-wide finding.
 *   No separate `scope` enum - this optional id already says everything a
 *   1B consumer needs.
 * - `action`: optional; omitted entirely when no existing command safely
 *   resolves the problem (see `frameworkDependencyCheck.ts`'s FastAPI case).
 *
 * No `frameworkId` and no `source` field: the dot-namespaced `code` already
 * encodes both which framework a result is about and which check produced
 * it, so a separate field would only duplicate that information.
 */
export interface DiagnosticResult {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly serviceId?: ServiceId;
  readonly action?: DiagnosticAction;
}
