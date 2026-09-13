export interface ScaffoldStepResult {
  readonly succeeded: boolean;
  /** Top-level paths this step newly created (did not exist before it ran) - the only paths safe to remove during cleanup (spec §30). */
  readonly createdPaths: readonly string[];
  readonly errorMessage?: string;
}

export interface ScaffoldStep {
  readonly id: string;
  readonly label: string;
  execute(): Promise<ScaffoldStepResult>;
}

export interface ScaffoldExecutionResult {
  readonly completedStepIds: readonly string[];
  readonly failedStep?: { readonly id: string; readonly label: string; readonly errorMessage: string };
  readonly createdPaths: readonly string[];
  readonly cancelled: boolean;
}

/**
 * Structurally compatible with vscode.CancellationToken (isCancellationRequested)
 * without importing "vscode" into this pure module - a real token can be
 * passed in directly by the command layer.
 */
export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
}

/**
 * Runs scaffold steps in order, stopping at the first failure (spec §30:
 * "If scaffolding fails halfway: keep a record of what the extension
 * created, explain partial state... Never delete pre-existing files during
 * rollback"). createdPaths accumulates only paths steps report as newly
 * created, which is exactly the safe-to-clean-up set.
 *
 * Cancellation (spec §42) is checked between steps, not mid-step: a step
 * already in flight (e.g. a slow `pip install`) still runs to completion,
 * but no further step starts once cancellation is requested. This is a
 * deliberate, documented scope boundary rather than true subprocess
 * abortion, which would need cancellation plumbed through the process
 * spawner itself.
 */
export async function executeScaffoldSteps(
  steps: readonly ScaffoldStep[],
  onStepStart?: (step: ScaffoldStep) => void,
  cancellation?: CancellationSignal
): Promise<ScaffoldExecutionResult> {
  const completedStepIds: string[] = [];
  const createdPaths: string[] = [];

  for (const step of steps) {
    if (cancellation?.isCancellationRequested === true) {
      return { completedStepIds, createdPaths, cancelled: true };
    }

    onStepStart?.(step);
    const result = await step.execute();
    createdPaths.push(...result.createdPaths);

    if (!result.succeeded) {
      return {
        completedStepIds,
        failedStep: { id: step.id, label: step.label, errorMessage: result.errorMessage ?? "Unknown error" },
        createdPaths,
        cancelled: false
      };
    }

    completedStepIds.push(step.id);
  }

  return { completedStepIds, createdPaths, cancelled: false };
}
