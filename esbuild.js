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

/**
 * The Password Hasher dev tool needs real bcrypt, which isn't something to hand-roll inline like
 * every other webview tool. bcryptjs's UMD build is dependency-free and browser-safe (uses the Web
 * Crypto API, not Node's crypto), so it's vendored as a plain <script> the same way codicons are.
 */
function copyBcrypt() {
  const srcFile = path.join(__dirname, "node_modules", "bcryptjs", "umd", "index.js");
  const outDir = path.join(__dirname, "resources", "vendor");
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(outDir, "bcrypt.js"));
}

async function main() {
  copyCodicons();
  copyBcrypt();
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
