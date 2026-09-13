export type RatingStatus = "pending" | "dismissed" | "rated";

/** Successful server starts are used as the "did this actually help someone" signal - a plain install/activation count would trigger even for someone who never used it. */
export const USAGE_THRESHOLD = 10;
export const MIN_DAYS_SINCE_FIRST_USE = 3;
export const SNOOZE_ADDITIONAL_USES = 10;
export const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface RatingPromptDecisionInput {
  readonly status: RatingStatus;
  readonly isPublished: boolean;
  readonly usageCount: number;
  readonly snoozeUntilCount: number;
  readonly firstActivatedAt: number;
  readonly now: number;
}

/**
 * Pure gate for the "rate this extension" prompt: real, sustained use only
 * (never on first install), never once dismissed/rated, and never at all
 * while `isPublished` is false - kept separate from the vscode.Memento/
 * Extension plumbing in ratingPromptController.ts so the threshold math is
 * unit-testable without an Extension Host.
 */
export function shouldPromptForRating(input: RatingPromptDecisionInput): boolean {
  if (input.status !== "pending" || !input.isPublished) {
    return false;
  }
  if (input.usageCount < Math.max(USAGE_THRESHOLD, input.snoozeUntilCount)) {
    return false;
  }
  return input.now - input.firstActivatedAt >= MIN_DAYS_SINCE_FIRST_USE * DAY_IN_MILLISECONDS;
}
