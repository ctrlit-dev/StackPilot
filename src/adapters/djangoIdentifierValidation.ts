/**
 * Validates a Django app name before it is ever passed to `startapp` (spec
 * §11/§21: "Validate Django identifiers... Never permit command injection
 * through a project/app name"). The strict ASCII allowlist regex already
 * rejects whitespace, Unicode, and shell metacharacters as a side effect of
 * only accepting identifier characters - no separate checks are needed for
 * those cases.
 */
const DJANGO_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Python 3 keyword list (stable, public language reference - keyword.kwlist).
const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"
]);

export type IdentifierValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

export function validateDjangoAppName(name: string): IdentifierValidationResult {
  if (name.length === 0) {
    return { valid: false, reason: "App name must not be empty." };
  }
  if (!DJANGO_IDENTIFIER_PATTERN.test(name)) {
    return {
      valid: false,
      reason: "App name must start with a letter or underscore and contain only ASCII letters, digits, and underscores."
    };
  }
  if (PYTHON_KEYWORDS.has(name)) {
    return { valid: false, reason: `"${name}" is a reserved Python keyword and cannot be used as an app name.` };
  }
  return { valid: true };
}
