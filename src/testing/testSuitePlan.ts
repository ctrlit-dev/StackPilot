import { planDjangoTest } from "../commands/backendOperationPlans";
import { planTestFrontend } from "../commands/frontendOperationPlans";
import type { DetectedProject } from "../detection/projectDetector";
import type { OneShotCommandOptions } from "../execution/oneShotCommand";

export interface TestSuitePlan {
  readonly kind: "ready" | "unavailable";
  readonly command?: OneShotCommandOptions;
  /** Human-readable reason shown in the Test Explorer when `kind` is "unavailable". */
  readonly reason?: string;
}

/**
 * Adapts the existing backend/frontend operation plans (already used by the
 * tree's "Tests" rows) into the shape the Test Explorer controller needs -
 * one command to run, or one reason it cannot run yet. Kept vscode-free so
 * it is unit-testable the same way as every other plan function here.
 */
export function backendTestSuitePlan(detectedProject: DetectedProject | undefined): TestSuitePlan {
  const plan = planDjangoTest(detectedProject);
  if (plan.kind === "ready") {
    return { kind: "ready", command: plan.command };
  }
  return {
    kind: "unavailable",
    reason: plan.kind === "no-backend" ? "No Django project was detected." : "No Python interpreter was found."
  };
}

export function frontendTestSuitePlan(detectedProject: DetectedProject | undefined, testScript: string): TestSuitePlan {
  const plan = planTestFrontend(detectedProject, testScript);
  if (plan.kind === "ready") {
    return { kind: "ready", command: plan.command };
  }

  if (plan.kind === "no-frontend") {
    return { kind: "unavailable", reason: "No Vite frontend was detected." };
  }
  if (plan.kind === "package-manager-missing") {
    return { kind: "unavailable", reason: plan.reason };
  }
  if (plan.kind === "package-manager-ambiguous") {
    return { kind: "unavailable", reason: `Multiple package managers were detected (${plan.candidates.join(", ")}).` };
  }
  return { kind: "unavailable", reason: `No "${testScript}" script was found in package.json.` };
}
