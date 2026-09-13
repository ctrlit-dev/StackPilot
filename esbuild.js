const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * The webview loads codicons from a static file, not through the bundle, so the two files it
 * actually needs are copied out of node_modules instead of shipping the whole @vscode/codicons
 * package (which includes hundreds of unused per-icon assets) in the VSIX.
 */
function copyCodicons() {
  const srcDir = path.join(__dirname, "node_modules", "@vscode", "codicons", "dist");
  const outDir = path.join(__dirname, "resources", "codicons");
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of ["codicon.css", "codicon.ttf"]) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  }
}

async function main() {
  copyCodicons();
  fs.rmSync(path.join(__dirname, "dist"), { recursive: true, force: true });

  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    external: ["vscode"],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: "info"
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
