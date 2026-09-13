import * as vscode from "vscode";
import { runOneShotCommand } from "../execution/oneShotCommand";
import type { ProcessSpawner } from "../execution/processSpawner";
import type { WorkspaceTrustService } from "../security/workspaceTrust";
import type { ProjectState, ProjectStateStore } from "../state/projectState";
import type { TestSuitePlan } from "./testSuitePlan";

/**
 * A coarse-grained Test Explorer integration: one runnable item representing
 * "the whole suite" per side, not individual test functions. Django's
 * default runner and whatever frontend test framework is in use each have
 * their own output format - parsing either reliably enough to build a real
 * per-test tree was judged too fragile (the same reasoning this codebase
 * already applies to requirements.txt parsing and Poetry/uv detection).
 * Pass/fail here comes from the same exit-code signal every other operation
 * in this extension already uses.
 */
export class TestSuiteController implements vscode.Disposable {
  private readonly controller: vscode.TestController;
  private readonly rootItem: vscode.TestItem;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    id: string,
    private readonly label: string,
    private readonly spawner: ProcessSpawner,
    private readonly projectState: ProjectStateStore,
    private readonly workspaceTrust: WorkspaceTrustService,
    private readonly planFor: (state: ProjectState) => TestSuitePlan
  ) {
    this.controller = vscode.tests.createTestController(id, label);
    this.rootItem = this.controller.createTestItem(`${id}.all`, label);
    this.controller.items.add(this.rootItem);
    this.controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, (request, token) => this.runHandler(request, token), true);

    this.disposables.push(this.controller, projectState.onDidChangeState(() => this.refresh()));
    this.refresh();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(): void {
    const plan = this.planFor(this.projectState.getState());
    this.rootItem.error = plan.kind === "unavailable" ? plan.reason : undefined;
  }

  private async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    if (!(await this.workspaceTrust.ensureTrustedForExecution(`Run ${this.label}`))) {
      return;
    }

    const run = this.controller.createTestRun(request);
    const items = request.include ?? [this.rootItem];

    for (const item of items) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }
      await this.runItem(run, item);
    }

    run.end();
  }

  private async runItem(run: vscode.TestRun, item: vscode.TestItem): Promise<void> {
    const plan = this.planFor(this.projectState.getState());
    if (plan.kind !== "ready" || plan.command === undefined) {
      run.errored(item, new vscode.TestMessage(plan.reason ?? "Not available."));
      return;
    }

    run.started(item);
    const startedAt = Date.now();
    const result = await runOneShotCommand(this.spawner, plan.command, (chunk) => run.appendOutput(toCarriageReturnLineFeed(chunk), undefined, item));
    const duration = Date.now() - startedAt;

    if (result.outcome === "spawn-failed") {
      run.errored(item, new vscode.TestMessage(`Failed to start: ${result.reason}`), duration);
      return;
    }
    if (result.exitCode === 0) {
      run.passed(item, duration);
      return;
    }
    run.failed(item, new vscode.TestMessage(`Exited with code ${result.exitCode ?? "null"}. See the test output for details.`), duration);
  }
}

/** The Test Output pane, like a terminal, expects CRLF line endings to render each line correctly. */
function toCarriageReturnLineFeed(chunk: string): string {
  return chunk.replace(/\r?\n/g, "\r\n");
}
