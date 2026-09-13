export interface CrashLoopPolicy {
  readonly maxConsecutiveRestarts: number;
  readonly backoffMillisecondsByAttempt: readonly number[];
}

/**
 * Auto-restart is opt-in (spec-consistent with every other automatic-execution
 * setting in this extension defaulting to off) and, once enabled, still needs
 * a hard stop - a server that fails immediately on every start (e.g. a syntax
 * error) must not be relaunched forever. Three attempts with increasing
 * backoff gives a flaky one-off crash a real chance to recover without
 * turning a broken server into an infinite restart loop.
 */
export const DEFAULT_CRASH_LOOP_POLICY: CrashLoopPolicy = {
  maxConsecutiveRestarts: 3,
  backoffMillisecondsByAttempt: [1000, 2000, 4000]
};

/**
 * Returns the delay before the next restart attempt, or undefined once the
 * policy's attempt budget is exhausted (the caller should give up and notify
 * the user instead of restarting again). `consecutiveFailureCount` is
 * 1-based: 1 for the first crash since the server was last healthy.
 */
export function nextRestartDelayMs(policy: CrashLoopPolicy, consecutiveFailureCount: number): number | undefined {
  if (consecutiveFailureCount < 1 || consecutiveFailureCount > policy.maxConsecutiveRestarts) {
    return undefined;
  }
  const index = Math.min(consecutiveFailureCount - 1, policy.backoffMillisecondsByAttempt.length - 1);
  return policy.backoffMillisecondsByAttempt[index];
}
