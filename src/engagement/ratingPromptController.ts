import * as vscode from "vscode";
import type { ProcessManager } from "../execution/processManager";
import { SNOOZE_ADDITIONAL_USES, shouldPromptForRating, type RatingStatus } from "./ratingPromptPolicy";

const KEY_FIRST_ACTIVATED_AT = "stackPilot.rating.firstActivatedAt";
const KEY_USAGE_COUNT = "stackPilot.rating.usageCount";
const KEY_STATUS = "stackPilot.rating.status";
const KEY_SNOOZE_UNTIL_COUNT = "stackPilot.rating.snoozeUntilCount";

/**
 * Prompts for a Marketplace rating after real, sustained use - see
 * ratingPromptPolicy.ts for the exact gate. Notably: this stays completely
 * dormant for a private/unpublished build like the one this was written
 * against (no `publisher` in package.json), and activates itself
 * automatically the moment a publisher id exists - no placeholder URL to
 * come back and fix before publishing.
 */
export class RatingPromptController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private promptedThisSession = false;

  public constructor(
    private readonly globalState: vscode.Memento,
    private readonly extension: vscode.Extension<unknown>,
    processManager: ProcessManager
  ) {
    if (this.globalState.get<number>(KEY_FIRST_ACTIVATED_AT) === undefined) {
      void this.globalState.update(KEY_FIRST_ACTIVATED_AT, Date.now());
    }

    this.disposables.push(
      processManager.onDidChangeState((descriptor) => {
        if (descriptor.state === "running") {
          void this.recordUsage();
        }
      })
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async recordUsage(): Promise<void> {
    if (this.promptedThisSession) {
      return;
    }

    const usageCount = (this.globalState.get<number>(KEY_USAGE_COUNT) ?? 0) + 1;
    await this.globalState.update(KEY_USAGE_COUNT, usageCount);

    const shouldPrompt = shouldPromptForRating({
      status: this.globalState.get<RatingStatus>(KEY_STATUS, "pending"),
      isPublished: this.isPublished(),
      usageCount,
      snoozeUntilCount: this.globalState.get<number>(KEY_SNOOZE_UNTIL_COUNT, 0),
      firstActivatedAt: this.globalState.get<number>(KEY_FIRST_ACTIVATED_AT, Date.now()),
      now: Date.now()
    });
    if (!shouldPrompt) {
      return;
    }

    this.promptedThisSession = true;
    await this.promptForRating(usageCount);
  }

  private isPublished(): boolean {
    const packageJson = this.extension.packageJSON as { readonly publisher?: unknown };
    return typeof packageJson.publisher === "string" && packageJson.publisher.length > 0;
  }

  private async promptForRating(usageCount: number): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      "Enjoying StackPilot? A rating helps other developers find it.",
      "Rate Now",
      "Later",
      "Don't Ask Again"
    );

    if (choice === "Rate Now") {
      await vscode.env.openExternal(
        vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${this.extension.id}&ssr=false#review-details`)
      );
      await this.globalState.update(KEY_STATUS, "rated" satisfies RatingStatus);
      return;
    }
    if (choice === "Don't Ask Again") {
      await this.globalState.update(KEY_STATUS, "dismissed" satisfies RatingStatus);
      return;
    }
    // "Later", or dismissed without picking anything: ask again after more use rather than nagging next time.
    await this.globalState.update(KEY_SNOOZE_UNTIL_COUNT, usageCount + SNOOZE_ADDITIONAL_USES);
  }
}
