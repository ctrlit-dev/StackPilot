import assert from "node:assert/strict";
import test from "node:test";

import { parseInstalledVersion } from "../../src/project/pipVersionParsing";

const REAL_PIP_SHOW_OUTPUT = `Name: Django
Version: 6.1.1
Summary: A high-level Python web framework that encourages rapid development and clean, pragmatic design.
Home-page: https://www.djangoproject.com/
Author:
Author-email: Django Software Foundation <foundation@djangoproject.com>
License-Expression: BSD-3-Clause
Location: C:\\Users\\Dominik\\AppData\\Local\\Temp\\pc-pipshow-test\\.venv\\Lib\\site-packages
Requires: asgiref, sqlparse, tzdata
Required-by:
`;

void test("parses the version from real pip show output", () => {
  assert.equal(parseInstalledVersion(REAL_PIP_SHOW_OUTPUT), "6.1.1");
});

void test("returns undefined when there is no Version line", () => {
  assert.equal(parseInstalledVersion("Name: Django\n"), undefined);
});

void test("returns undefined for empty output", () => {
  assert.equal(parseInstalledVersion(""), undefined);
});
