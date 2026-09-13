# Testing

## Unit tests

```sh
npm run test:unit
```

Runs on Node's built-in `node:test` runner (`node --test`), compiled output
under `out/test/unit/**/*.test.js`. No VS Code Extension Host is involved, so
these run anywhere Node runs, including CI.

Every unit test uses a fake instead of touching real processes or the real
filesystem:

- `FileSystemProbe` → `InMemoryFileSystemProbe` (`test/unit/fakes/`), used for
  all detection tests.
- `ProcessSpawner` → `FakeProcessSpawner`/`FakeSpawnedProcess`, used for
  process-manager, one-shot-command, and scaffold-step tests. It supports
  both fully manual control (`emitOutput`/`emitExit`, for testing exact race
  timing) and an `autoExit()`/`queueAutoSuccess()` convenience for driving a
  long sequential chain of commands (the New Project scaffold) without
  hand-interleaving each step.
- `ProjectFileWriter` → `InMemoryProjectFileWriter`, used for scaffold-step
  and collision-check tests.

This is why the suite can cover things like "a Windows delayed-ENOENT quirk
after a successful spawn", "create-vite reports exit 0 but wrote nothing", or
a complete multi-step New Project run - all of the risky, environment-specific
behavior is captured in the fakes based on real, empirically-verified
behavior (see the doc comments on `nodeProcessSpawner.ts` and
`viteScaffoldStep` for exactly what was verified and how), so the pure
orchestration logic can be exercised deterministically and quickly.

As of this writing there are 252 unit tests; run `npm run test:unit` for the
current, authoritative count and pass/fail state rather than trusting a
number in a document that can go stale.

## Integration tests

```sh
npm run test:integration
```

Uses `@vscode/test-electron` to download (if not cached) a real VS Code
build and run `test/integration/suite/index.ts` inside a real Extension
Development Host - it activates the extension, checks that every contributed
command is actually registered, and checks the tree view is contributed in
the manifest.

**Known environment limitation**: in the sandbox this extension was built in,
`test:integration` fails before the suite even runs - the downloaded `Code.exe`
rejects every Electron/Chromium launch flag it is given
(`bad option: --no-sandbox`, etc.), reproducibly, for two different VS Code
versions (the sandbox's current "stable" build and the version pinned to the
extension's own `engines.vscode` floor). This is an environment restriction
on running Electron GUI processes in that specific sandbox, not a defect in
the test or the extension - `test:unit` and manual real-process smoke testing
(see below) were used instead to verify behavior that would normally be
covered by this suite. Run `npm run test:integration` yourself on a normal
desktop machine to get real Extension Host coverage.

## Manual/real-process verification

Some behavior is real-environment-specific enough that a unit test with a
fake cannot prove it works, and was instead verified once, by hand, against
the real tool, with the exact result documented at the point in the code that
depends on it:

- Windows venv layout (`Scripts/python.exe`, `Lib/site-packages/...`) and a
  real `pip install`/`pip show` round trip - `detection/pythonPackageCheck.ts`,
  `detection/venvHealthCheck.ts`.
- The exact non-interactive `npm create vite@latest` flags, and the
  discovery that a non-empty target directory makes it print "Operation
  cancelled" and exit **0** (not a failure code) - `viteScaffoldStep` in
  `project/scaffoldSteps.ts` checks for `package.json` afterward specifically
  because of this.
- Vite's real, ANSI-colored `Local:` output line, including that the port
  number is wrapped in its own escape sequence - `execution/frontendUrlTracker.ts`.
- A complete Django-only New Project scaffold (real venv, real `pip install
  Django`, real `startproject`/`startapp`, real `git init`) run end-to-end
  against a temporary directory outside the repository, then deleted.
- A real child process spawned with a working directory containing spaces,
  to confirm no Windows quoting bug.

These are not automated (they require real Python/npm/git and network
access) and are not re-run on every change; treat them as verified-once
evidence for the specific claims above, not as regression coverage - the
regression coverage for the *logic* built on top of these findings (e.g. "an
exit-0-with-no-package.json is treated as a failure") is in the unit suite.

## What is not covered

- pnpm/yarn/bun's own New Project scaffold commands are implemented per
  Vite's official documentation but were not independently smoke-tested,
  since none of those tools were available in the environment this was built
  in (only npm was). See `execution/viteScaffoldCommand.ts`.
- True mid-command cancellation (aborting an in-flight `pip install`, say) is
  not implemented - the New Project wizard's cancellation stops the run
  before the *next* step starts, but a step already running completes first.
