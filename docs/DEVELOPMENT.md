# Development

## Prerequisites

- Node.js (a recent LTS; the repository was built and tested with Node 24).
- npm (used to install this repository's own dependencies).
- For actually exercising the extension's features locally: Python 3 and, if
  you want to test frontend scaffolding/operations, at least one of
  npm/pnpm/yarn/bun.

## Setup

```sh
npm install
```

## Running the extension while developing

1. Open this repository in VS Code.
2. Press `F5` (or "Run and Debug" → "Run Extension"). This runs the
   `compile & bundle` task (TypeScript typecheck, then an esbuild bundle to
   `dist/extension.js`) and launches an Extension Development Host window
   with the result loaded.
3. Open a folder containing a Django/Vite project (or use the "New Django +
   Vite Project…" command from the StackPilot sidebar to create one) in
   that development host window.

`npm run watch` (TypeScript, typecheck only) and `npm run watch:esbuild`
(rebuilds `dist/extension.js` on save) can both run in background terminals
if you prefer that to re-running the debug launch's build step after every
change.

## Project layout

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the source is organized and
why. In short: `detection/` is read-only, `execution/` runs processes,
`project/` is the only part that creates files, `commands/` and `ui/` are the
thin VS Code-facing layer on top of all of that.

## Quality checks

```sh
npm run compile      # TypeScript typecheck + build
npm run lint          # ESLint
npm run test:unit      # node:test unit suite (no VS Code needed)
npm run test:integration  # Extension Development Host smoke test
npm run test          # test:unit then test:integration
```

Run these before opening a change for review; `npm run compile` and
`npm run lint` are fast enough to run on every save via `npm run watch` plus
your editor's ESLint integration.

See [`TESTING.md`](TESTING.md) for what each suite actually covers and a
known environment limitation with `test:integration`.

## Packaging a local `.vsix`

```sh
npm run vsix
```

This runs `vsce package`, which first runs the `vscode:prepublish` script
(`esbuild.js --production`) to produce a single minified `dist/extension.js`
bundle. `cross-spawn` and `@vscode/codicons` are both `devDependencies`: the
former is inlined into the bundle by esbuild, and the latter's `codicon.css`
+ `codicon.ttf` are copied into `resources/codicons/` by `esbuild.js` for the
dashboard webview to load as static assets - neither needs to exist under
`node_modules` at runtime, so nothing under `node_modules` ships in the
`.vsix`. If a new runtime dependency is ever added and can't be bundled
(a native module, for example), move it back to `dependencies` so `vsce`
includes it.

Install the result via the Extensions view's "Install from VSIX..." command,
or:

```sh
code --install-extension stackpilot-0.0.1.vsix
```

## Conventions

- TypeScript `strict` mode is on; do not add `any` to work around a type
  error.
- Prefer extending an existing pure module over adding a new abstraction -
  most detection/execution/project logic is already split into a
  pure/testable part and a thin real adapter (see `ARCHITECTURE.md`).
- Any new code that talks to Node's `fs`/`child_process` directly, or to a
  `vscode.*` API that cannot be exercised by `node:test`, should go in a thin
  adapter with the actual decision logic kept separately testable next to it.
- Do not add a runtime dependency without checking whether a standard
  Node/VS Code API already solves the problem cleanly (see the `cross-spawn`
  rationale in `ARCHITECTURE.md` for what "actually justified" looks like).
