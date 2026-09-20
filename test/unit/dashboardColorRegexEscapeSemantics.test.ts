import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

/**
 * dashboardPanelController.ts's page() method returns one large, untagged
 * ("cooked") template literal (source lines ~813-2709) that is the
 * webview's own inline <script> source, embedded as plain text - not real
 * TypeScript/JavaScript syntax as far as the outer .ts file's parser is
 * concerned. Every character inside it goes through standard JS
 * template-literal escape processing before it ever reaches the browser:
 * per ECMA-262, a backslash before a recognized SingleEscapeCharacter
 * (n t r b f v 0 x u \ ' " ` $ and line terminators) produces that
 * character's real escaped value (\\ collapses to one literal backslash),
 * while a backslash before anything else (NonEscapeCharacter) is simply
 * dropped.
 *
 * parseRgbString/parseHslString's regex therefore needs a SECOND escape
 * level in the TypeScript source: \\( \\s \\d \\) - so that after the outer
 * template literal collapses \\ to \, the webview actually receives
 * \( \s \d \), real, functioning regex escapes (MARKETPLACE-RELEASE-1D.1).
 * A single \( \s \d \) there - the state MARKETPLACE-RELEASE-1D's
 * no-useless-escape cleanup correctly left in place, byte-identical to the
 * pre-1D bug - gets silently dropped by that same rule, producing a broken
 * regex that cannot parse any rgb()/rgba()/hsl()/hsla() string.
 *
 * This test extracts the real regex text from the actual source file,
 * reproduces the exact ECMA-262 cooked-template transform (not a
 * hand-copied regex constant duplicated from the source), and verifies the
 * resulting RegExp against realistic inputs and their capture groups - so a
 * future edit that reintroduces the single-escape mistake (or otherwise
 * changes the delivered regex) fails this test.
 */
const dashboardControllerPath = path.resolve(__dirname, "..", "..", "..", "src", "ui", "dashboardPanelController.ts");
const source = fs.readFileSync(dashboardControllerPath, "utf8").replace(/\r\n/g, "\n");

/** ECMA-262 SingleEscapeCharacter -> the real character value a "cooked" template literal produces for it. */
const RECOGNIZED_ESCAPE_VALUES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "`": "`",
  $: "$"
};

/** Reproduces ECMA-262 "cooked" template-literal escape processing: SingleEscapeCharacter -> its real value, NonEscapeCharacter -> the backslash is dropped and the character kept as-is. */
function asCookedTemplateText(rawQuasiText: string): string {
  return rawQuasiText.replace(
    /\\(.)/g,
    (_full: string, escaped: string) => RECOGNIZED_ESCAPE_VALUES[escaped] ?? escaped
  );
}

function extractMatchArgument(functionName: string): string {
  const marker = `function ${functionName}(value) {\n    const match = value.match(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `could not locate "${marker.replace(/\n/g, "\\n")}" in dashboardPanelController.ts`);
  const afterMarker = start + marker.length;
  const end = source.indexOf(");", afterMarker);
  return source.slice(afterMarker, end);
}

/** Builds the actual RegExp the webview browser receives for `functionName`, derived from the real page() source text - not a separately hand-written duplicate. */
function deliveredRegex(functionName: string): RegExp {
  const deliveredLiteralText = asCookedTemplateText(extractMatchArgument(functionName));
  const lastSlash = deliveredLiteralText.lastIndexOf("/");
  assert.ok(lastSlash > 0, `expected a /pattern/flags regex literal, got: ${deliveredLiteralText}`);
  return new RegExp(deliveredLiteralText.slice(1, lastSlash), deliveredLiteralText.slice(lastSlash + 1));
}

void test("dashboardPanelController.ts: the webview actually receives working regex escapes for parseRgbString, not the dropped-backslash form", () => {
  const re = deliveredRegex("parseRgbString");

  assert.deepEqual("rgb(255, 0, 128)".match(re)?.slice(1, 5), ["255", "0", "128", undefined]);
  assert.deepEqual("rgb(255,0,128)".match(re)?.slice(1, 5), ["255", "0", "128", undefined]);
  assert.deepEqual("rgba(255, 0, 128, 0.5)".match(re)?.slice(1, 5), ["255", "0", "128", "0.5"]);

  assert.equal("not a color".match(re), null);
  assert.equal("rgb(255 0 128)".match(re), null, "commas between components are required, not optional whitespace");
  assert.equal("rgb(255, 0)".match(re), null, "all three of r, g, b are required");
});

void test("dashboardPanelController.ts: the webview actually receives working regex escapes for parseHslString, not the dropped-backslash form", () => {
  const re = deliveredRegex("parseHslString");

  assert.deepEqual("hsl(120, 50%, 25%)".match(re)?.slice(1, 5), ["120", "50", "25", undefined]);
  assert.deepEqual("hsla(120, 50%, 25%, 0.5)".match(re)?.slice(1, 5), ["120", "50", "25", "0.5"]);

  assert.equal("not a color".match(re), null);
  assert.equal("hsl(120, 50, 25)".match(re), null, "the % signs after s and l are required");
  assert.equal("hsl(120, 50%, 25)".match(re), null, "both % signs are required");
});
