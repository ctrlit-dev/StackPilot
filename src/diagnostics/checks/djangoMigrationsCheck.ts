import { getBackendService, getDjangoMetadata } from "../../detection/detectedProject";
import { COMMAND_MIGRATE } from "../../constants";
import type { MigrationStatus } from "../../execution/migrationStatusController";
import { BACKEND_SERVICE_ID } from "../../serviceId";
import type { DiagnosticResult } from "../diagnostic";
import type { DiagnosticCheck } from "../diagnosticCheck";

/**
 * The structural subset of `MigrationStatusController`'s public surface this
 * check (and `DiagnosticsController`'s refresh wiring) actually need.
 * Defined locally, not imported as a class type, so this module and its
 * tests never pull in `MigrationStatusController`'s own runtime `vscode`
 * import (DIAGNOSTICS-1A review, §27) - a real `MigrationStatusController`
 * instance already satisfies this shape with no adapter needed.
 */
export interface MigrationStatusReader {
  getStatus(): MigrationStatus;
  onDidChangeStatus(listener: () => void): { dispose(): void };
}

/**
 * Wraps the existing, already-trust-gated `MigrationStatusController` read-only
 * (`getStatus()`) instead of re-running `manage.py migrate --check` itself -
 * no new process spawn, no change to that controller. Isolated to Django: a
 * FastAPI-only project's backend never has Django metadata, so this never
 * emits for it regardless of what `reader.getStatus()` happens to return.
 *
 * Mapping: only "pending" produces a result. "up-to-date", "checking",
 * "unknown", and "unavailable" all mean "nothing actionable to report right
 * now" - a transient/unresolved status is not itself a user-facing problem.
 */
export function createDjangoMigrationsCheck(reader: MigrationStatusReader): DiagnosticCheck {
  return {
    run(context) {
      const backend = getBackendService(context.detectedProject);
      if (getDjangoMetadata(backend) === undefined) {
        return Promise.resolve([]);
      }

      if (reader.getStatus() !== "pending") {
        return Promise.resolve([]);
      }

      const result: DiagnosticResult = {
        code: "django.migrations.pending",
        severity: "warning",
        message: "There are unapplied Django migrations.",
        serviceId: BACKEND_SERVICE_ID,
        action: { label: "Migrate", commandId: COMMAND_MIGRATE }
      };
      return Promise.resolve([result]);
    }
  };
}
